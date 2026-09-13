import type { DbTransaction } from "@accly/db/counter";
import { accounts } from "@accly/db/schema/accounts";
import type { AdvanceSupply, DocumentType } from "@accly/db/schema/documents";
import { journalEntries } from "@accly/db/schema/journal-entries";
import { journalLines } from "@accly/db/schema/journal-lines";
import { and, eq, isNotNull } from "drizzle-orm";

import type { Scope } from "../lib/procedures/factory";
import { applyBalances } from "./balances";
import { SYSTEM_ACCOUNT_KEYS } from "./chart-templates";
import type { SystemAccountKey } from "./chart-templates";

export type JournalLineInput = {
  accountId: string;
  partyId: string | null;
  debit: bigint;
  credit: bigint;
};

export type ReceiptPosting =
  | {
      settlementKind: "advance";
      advanceSupply: AdvanceSupply;
      exposureSide: "receivable";
      partyId: string;
      amountPaise: bigint;
      incomeAccountId: null;
    }
  | {
      settlementKind: "direct";
      exposureSide: null;
      partyId: string | null;
      amountPaise: bigint;
      incomeAccountId: string;
    };

export type ResolvedAccounts = {
  paymentMethodAccountId: string;
  byKey: Record<SystemAccountKey, string>;
};

export function postReceipt(
  document: ReceiptPosting,
  accounts: ResolvedAccounts,
): JournalLineInput[] {
  if (document.amountPaise <= 0n) {
    throw new Error("Receipt amount must be positive");
  }

  const debit: JournalLineInput = {
    accountId: accounts.paymentMethodAccountId,
    partyId: null,
    debit: document.amountPaise,
    credit: 0n,
  };

  if (document.settlementKind === "direct") {
    return [
      debit,
      {
        accountId: document.incomeAccountId,
        partyId: document.partyId,
        debit: 0n,
        credit: document.amountPaise,
      },
    ];
  }

  return [
    debit,
    {
      accountId: accounts.byKey.customerAdvances,
      partyId: document.partyId,
      debit: 0n,
      credit: document.amountPaise,
    },
  ];
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
      document: {
        id: string;
        type: "receipt";
        entryDate: string;
        narration: string;
        posting: ReceiptPosting;
        paymentMethodAccountId: string;
      };
    }
  | {
      kind: "reverse";
      document: { id: string; type: DocumentType };
      reversesEntryId: string;
      entryDate: string;
      narration: string;
    };

async function resolveSystemAccounts(
  tx: DbTransaction,
  orgId: string,
): Promise<Record<SystemAccountKey, string>> {
  const rows = await tx
    .select({ id: accounts.id, systemKey: accounts.systemKey })
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), isNotNull(accounts.systemKey)));

  const ids = new Map(rows.map((row) => [row.systemKey, row.id]));

  for (const key of SYSTEM_ACCOUNT_KEYS) {
    if (!ids.has(key)) {
      throw new Error(`Organization ${orgId} is missing system account ${key}`);
    }
  }

  // SAFETY: the loop above proved every SystemAccountKey has an id.
  return Object.fromEntries(SYSTEM_ACCOUNT_KEYS.map((key) => [key, ids.get(key)!])) as Record<
    SystemAccountKey,
    string
  >;
}

export async function recordEntry(
  tx: DbTransaction,
  scope: Scope,
  args: RecordEntryArgs,
): Promise<{ entryId: string }> {
  let lines: JournalLineInput[];
  let document: { id: string; type: DocumentType };
  let entryDate: string;
  let narration: string;
  let reversesEntryId: string | null = null;

  if (args.kind === "post") {
    document = args.document;
    entryDate = args.document.entryDate;
    narration = args.document.narration;
    const byKey = await resolveSystemAccounts(tx, scope.orgId);
    lines = postReceipt(args.document.posting, {
      paymentMethodAccountId: args.document.paymentMethodAccountId,
      byKey,
    });
  } else {
    document = args.document;
    entryDate = args.entryDate;
    narration = args.narration;
    reversesEntryId = args.reversesEntryId;

    const storedLines = await tx
      .select({
        accountId: journalLines.accountId,
        partyId: journalLines.partyId,
        debit: journalLines.debit,
        credit: journalLines.credit,
      })
      .from(journalLines)
      .where(
        and(eq(journalLines.orgId, scope.orgId), eq(journalLines.entryId, args.reversesEntryId)),
      );

    if (storedLines.length === 0) {
      throw new Error(`Journal entry ${args.reversesEntryId} has no lines in this organization`);
    }

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
    entryDate,
    narration,
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
  await applyBalances(tx, scope.orgId, entryDate, lines);

  return { entryId };
}
