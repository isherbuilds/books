import type { DbTransaction } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import type { AdvanceSupply, DocumentType } from "@accly/db/schema/documents";
import { journalEntries } from "@accly/db/schema/journal-entries";
import { journalLines } from "@accly/db/schema/journal-lines";
import { and, eq, inArray } from "drizzle-orm";

import type { Scope } from "../lib/procedures/factory";
import type { SystemAccountKey } from "./chart-templates";

type SystemAccounts = ReadonlyMap<SystemAccountKey, string>;

function systemAccount(byKey: SystemAccounts, key: SystemAccountKey): string {
  const id = byKey.get(key);

  if (!id) throw new Error(`Missing resolved system account ${key}`);

  return id;
}

export type JournalLineInput = {
  accountId: string;
  partyId: string | null;
  debit: bigint;
  credit: bigint;
};

// `methodAccountId` is the Payment Method's cash or bank account.
export type ReceiptPosting = { type: "receipt"; methodAccountId: string } & (
  | {
      settlementKind: "advance";
      advanceSupply: AdvanceSupply;
      exposureSide: "receivable";
      partyId: string;
      accountId: null;
      amountPaise: bigint;
    }
  | {
      settlementKind: "direct";
      exposureSide: null;
      partyId: string | null;
      accountId: string;
      amountPaise: bigint;
    }
);

type TdsDeduction = {
  sectionId: string;
  amountPaise: bigint;
};

export type PaymentPosting = {
  type: "payment";
  methodAccountId: string;
  tds: TdsDeduction | null;
} & (
  | {
      settlementKind: "advance";
      exposureSide: "payable";
      partyId: string;
      accountId: null;
      amountPaise: bigint;
    }
  | {
      settlementKind: "direct";
      exposureSide: null;
      partyId: string | null;
      accountId: string;
      amountPaise: bigint;
    }
);

export type DocumentPosting = ReceiptPosting | PaymentPosting;

export function postReceipt(document: ReceiptPosting, byKey: SystemAccounts): JournalLineInput[] {
  if (document.amountPaise <= 0n) {
    throw new Error("Receipt amount must be positive");
  }

  return [
    {
      accountId: document.methodAccountId,
      partyId: null,
      debit: document.amountPaise,
      credit: 0n,
    },
    {
      accountId:
        document.settlementKind === "direct"
          ? document.accountId
          : systemAccount(byKey, "customerAdvances"),
      partyId: document.partyId,
      debit: 0n,
      credit: document.amountPaise,
    },
  ];
}

export function computeTds(amountPaise: bigint, rateBasisPoints: number): bigint {
  const raw = amountPaise * BigInt(rateBasisPoints);
  const rupee = (raw + 500_000n) / 1_000_000n;

  return rupee * 100n;
}

export function postPayment(document: PaymentPosting, byKey: SystemAccounts): JournalLineInput[] {
  if (document.amountPaise <= 0n) {
    throw new Error("Payment amount must be positive");
  }

  if (
    document.tds !== null &&
    (document.tds.amountPaise < 0n || document.tds.amountPaise >= document.amountPaise)
  ) {
    throw new Error("Payment TDS must be non-negative and less than the payment amount");
  }

  const lines: JournalLineInput[] = [
    {
      accountId:
        document.settlementKind === "advance"
          ? systemAccount(byKey, "supplierAdvances")
          : document.accountId,
      partyId: document.partyId,
      debit: document.amountPaise,
      credit: 0n,
    },
    {
      accountId: document.methodAccountId,
      partyId: null,
      debit: 0n,
      credit: document.amountPaise - (document.tds?.amountPaise ?? 0n),
    },
  ];

  if (document.tds !== null && document.tds.amountPaise > 0n) {
    lines.push({
      accountId: systemAccount(byKey, "tdsPayable"),
      partyId: document.partyId,
      debit: 0n,
      credit: document.tds.amountPaise,
    });
  }

  return lines;
}

export function assertBalanced(lines: readonly JournalLineInput[]): void {
  let debitTotal = 0n;
  let creditTotal = 0n;

  for (const line of lines) {
    if (line.debit < 0n || line.credit < 0n) {
      throw new Error("Journal lines cannot contain negative values");
    }

    if (line.debit !== 0n && line.credit !== 0n) {
      throw new Error("A journal line cannot have both debit and credit values");
    }

    debitTotal += line.debit;
    creditTotal += line.credit;
  }

  if (debitTotal !== creditTotal) {
    throw new Error("Journal entry is not balanced");
  }
}

export function reverseLines(lines: readonly JournalLineInput[]): JournalLineInput[] {
  return lines.map((line) => ({
    accountId: line.accountId,
    partyId: line.partyId,
    debit: line.credit,
    credit: line.debit,
  }));
}

export type RecordEntryArgs =
  | {
      kind: "post";
      document: { id: string; posting: DocumentPosting };
      entryDate: string;
      narration: string;
    }
  | {
      kind: "reverse";
      document: { id: string; type: DocumentType };
      entryDate: string;
      narration: string;
    };

function requiredSystemAccounts(posting: DocumentPosting): SystemAccountKey[] {
  const keys: SystemAccountKey[] = [];

  if (posting.settlementKind === "advance") {
    keys.push(posting.type === "receipt" ? "customerAdvances" : "supplierAdvances");
  }

  if (posting.type === "payment" && posting.tds !== null && posting.tds.amountPaise > 0n) {
    keys.push("tdsPayable");
  }

  return keys;
}

async function resolveSystemAccounts(
  tx: DbTransaction,
  orgId: string,
  keys: readonly SystemAccountKey[],
): Promise<SystemAccounts> {
  if (keys.length === 0) return new Map();

  const rows = await tx
    .select({ id: accounts.id, systemKey: accounts.systemKey })
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), inArray(accounts.systemKey, keys)));

  const ids = new Map<SystemAccountKey, string>();

  for (const row of rows) {
    const key = keys.find((candidate) => candidate === row.systemKey);

    if (key) ids.set(key, row.id);
  }

  for (const key of keys) {
    if (!ids.has(key)) {
      throw new Error(`Organization ${orgId} is missing system account ${key}`);
    }
  }

  return ids;
}

// The only call Billing makes into General Accounting. A post runs the document
// type's posting function; a reverse swaps the stored lines of the post entry and
// never re-runs the posting function, rates or mappings.
export async function recordEntry(
  tx: DbTransaction,
  scope: Scope,
  args: RecordEntryArgs,
): Promise<void> {
  let lines: JournalLineInput[];
  let document: { id: string; type: DocumentType };
  let reversesEntryId: string | null = null;

  if (args.kind === "post") {
    const { posting } = args.document;
    document = { id: args.document.id, type: posting.type };

    const byKey = await resolveSystemAccounts(tx, scope.orgId, requiredSystemAccounts(posting));
    lines = posting.type === "receipt" ? postReceipt(posting, byKey) : postPayment(posting, byKey);
  } else {
    document = args.document;

    const storedLines = await tx
      .select({
        entryId: journalLines.entryId,
        accountId: journalLines.accountId,
        partyId: journalLines.partyId,
        debit: journalLines.debit,
        credit: journalLines.credit,
      })
      .from(journalLines)
      .innerJoin(
        journalEntries,
        and(eq(journalEntries.orgId, scope.orgId), eq(journalEntries.id, journalLines.entryId)),
      )
      .where(
        and(
          eq(journalLines.orgId, scope.orgId),
          eq(journalEntries.documentType, document.type),
          eq(journalEntries.documentId, document.id),
          eq(journalEntries.kind, "post"),
        ),
      );

    const [postLine] = storedLines;

    if (!postLine) {
      throw new Error(`Document ${document.id} is missing its post journal entry`);
    }

    reversesEntryId = postLine.entryId;
    lines = reverseLines(storedLines);
  }

  assertBalanced(lines);

  const entryId = Bun.randomUUIDv7();

  await tx.insert(journalEntries).values({
    id: entryId,
    orgId: scope.orgId,
    documentType: document.type,
    documentId: document.id,
    kind: args.kind,
    reversesEntryId,
    entryDate: args.entryDate,
    narration: args.narration,
    createdBy: scope.userId,
  });
  await tx.insert(journalLines).values(
    lines.map((line) => ({
      id: Bun.randomUUIDv7(),
      orgId: scope.orgId,
      entryId,
      ...line,
    })),
  );
}
