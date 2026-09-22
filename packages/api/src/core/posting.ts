import type { DbTransaction } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import type { EntrySide } from "@accly/db/schema/document-lines";
import type { AdvanceSupply, DocumentType } from "@accly/db/schema/documents";
import { journalEntries } from "@accly/db/schema/journal-entries";
import { journalLines } from "@accly/db/schema/journal-lines";
import { and, eq, inArray, isNotNull } from "drizzle-orm";

import type { Scope } from "../lib/procedures/factory";
import type { AllocationTarget } from "./allocations";
import type { SystemAccountKey } from "./chart-templates";
import { divideHalfUp } from "./money";

// Keyed by the text `systemKey` column, so reading it needs no cast; `systemAccount`
// still takes a typed key.
type SystemAccounts = ReadonlyMap<string, string>;

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
      settlementKind: "against";
      exposureSide: "receivable";
      partyId: string;
      accountId: null;
      amountPaise: bigint;
      allocations: readonly AllocationTarget[];
      advanceSupply: AdvanceSupply | null;
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

export type InvoiceLinePosting = { accountId: string; amountPaise: bigint };

export type InvoicePosting = {
  type: "invoice";
  exposureSide: "receivable";
  partyId: string;
  amountPaise: bigint;
  lines: readonly InvoiceLinePosting[];
  cgstPaise: bigint;
  sgstPaise: bigint;
  igstPaise: bigint;
  roundOffPaise: bigint;
};

export type JournalLinePosting = {
  accountId: string;
  partyId: string | null;
  side: EntrySide;
  amountPaise: bigint;
};

// The Opening Balance is a Journal by shape: its own lines are its legs.
type EntryLinesPosting<Type extends "journal" | "openingBalance"> = {
  type: Type;
  amountPaise: bigint;
  lines: readonly JournalLinePosting[];
};

export type JournalPosting = EntryLinesPosting<"journal">;

export type OpeningBalancePosting = EntryLinesPosting<"openingBalance">;

export type AllocationPosting = {
  type: "allocation";
  direction: "advanceToInvoice" | "invoiceToAdvance";
  partyId: string;
  amountPaise: bigint;
};

export type DocumentPosting =
  | ReceiptPosting
  | PaymentPosting
  | InvoicePosting
  | JournalPosting
  | OpeningBalancePosting;

export function postReceipt(document: ReceiptPosting, byKey: SystemAccounts): JournalLineInput[] {
  if (document.amountPaise <= 0n) {
    throw new Error("Receipt amount must be positive");
  }

  const lines: JournalLineInput[] = [
    {
      accountId: document.methodAccountId,
      partyId: null,
      debit: document.amountPaise,
      credit: 0n,
    },
  ];

  if (document.settlementKind === "against") {
    const allocatedPaise = document.allocations.reduce(
      (sum, { amountPaise }) => sum + amountPaise,
      0n,
    );

    if (allocatedPaise <= 0n) {
      throw new Error("Receipt allocated amount must be positive");
    }

    const remainderPaise = document.amountPaise - allocatedPaise;

    lines.push({
      accountId: systemAccount(byKey, "receivables"),
      partyId: document.partyId,
      debit: 0n,
      credit: allocatedPaise,
    });

    if (remainderPaise > 0n) {
      lines.push({
        accountId: systemAccount(byKey, "customerAdvances"),
        partyId: document.partyId,
        debit: 0n,
        credit: remainderPaise,
      });
    }

    return lines;
  }

  lines.push({
    accountId:
      document.settlementKind === "direct"
        ? document.accountId
        : systemAccount(byKey, "customerAdvances"),
    partyId: document.partyId,
    debit: 0n,
    credit: document.amountPaise,
  });

  return lines;
}

export function postAllocation(
  posting: AllocationPosting,
  byKey: SystemAccounts,
): JournalLineInput[] {
  if (posting.amountPaise <= 0n) {
    throw new Error("Allocation amount must be positive");
  }

  const advanceToInvoice: JournalLineInput[] = [
    {
      accountId: systemAccount(byKey, "customerAdvances"),
      partyId: posting.partyId,
      debit: posting.amountPaise,
      credit: 0n,
    },
    {
      accountId: systemAccount(byKey, "receivables"),
      partyId: posting.partyId,
      debit: 0n,
      credit: posting.amountPaise,
    },
  ];

  return posting.direction === "advanceToInvoice"
    ? advanceToInvoice
    : reverseLines(advanceToInvoice);
}

/** Paise times basis points, rounded half-up to the rupee. */
export function computeTds(amountPaise: bigint, rateBasisPoints: number): bigint {
  return divideHalfUp(amountPaise * BigInt(rateBasisPoints), 1_000_000n) * 100n;
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

export function postInvoice(document: InvoicePosting, byKey: SystemAccounts): JournalLineInput[] {
  if (document.amountPaise <= 0n) {
    throw new Error("Invoice amount must be positive");
  }

  if (document.lines.length === 0) {
    throw new Error("Invoice must have at least one line");
  }

  if (document.cgstPaise < 0n || document.sgstPaise < 0n || document.igstPaise < 0n) {
    throw new Error("Invoice taxes cannot be negative");
  }

  const incomeByAccount = new Map<string, bigint>();

  for (const line of document.lines) {
    if (line.amountPaise <= 0n) {
      throw new Error("Invoice line amount must be positive");
    }

    incomeByAccount.set(
      line.accountId,
      (incomeByAccount.get(line.accountId) ?? 0n) + line.amountPaise,
    );
  }

  const lines: JournalLineInput[] = [
    {
      accountId: systemAccount(byKey, "receivables"),
      partyId: document.partyId,
      debit: document.amountPaise,
      credit: 0n,
    },
  ];

  for (const [accountId, amountPaise] of incomeByAccount) {
    lines.push({ accountId, partyId: null, debit: 0n, credit: amountPaise });
  }

  for (const [key, amountPaise] of [
    ["cgstOutput", document.cgstPaise],
    ["sgstOutput", document.sgstPaise],
    ["igstOutput", document.igstPaise],
  ] as const) {
    if (amountPaise > 0n) {
      lines.push({
        accountId: systemAccount(byKey, key),
        partyId: null,
        debit: 0n,
        credit: amountPaise,
      });
    }
  }

  if (document.roundOffPaise !== 0n) {
    lines.push({
      accountId: systemAccount(byKey, "roundOff"),
      partyId: null,
      debit: document.roundOffPaise < 0n ? -document.roundOffPaise : 0n,
      credit: document.roundOffPaise > 0n ? document.roundOffPaise : 0n,
    });
  }

  return lines;
}

export function postJournal(document: JournalPosting | OpeningBalancePosting): JournalLineInput[] {
  if (document.lines.length < 2) {
    throw new Error("Journal must have at least two lines");
  }

  let debitTotal = 0n;
  let creditTotal = 0n;

  const lines = document.lines.map((line) => {
    if (line.amountPaise <= 0n) {
      throw new Error("Journal line amount must be positive");
    }

    if (line.side === "debit") {
      debitTotal += line.amountPaise;
    } else {
      creditTotal += line.amountPaise;
    }

    return {
      accountId: line.accountId,
      partyId: line.partyId,
      debit: line.side === "debit" ? line.amountPaise : 0n,
      credit: line.side === "credit" ? line.amountPaise : 0n,
    };
  });

  if (debitTotal !== creditTotal) {
    throw new Error("Journal debit and credit totals must match");
  }

  if (debitTotal !== document.amountPaise) {
    throw new Error("Journal debit total must match document amount");
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

// The validation every stored-line reversal passes, single or batched.
function reversalOf(entryId: string, storedLines: readonly JournalLineInput[]): JournalLineInput[] {
  if (storedLines.length === 0) {
    throw new Error(`Journal entry ${entryId} has no lines to reverse`);
  }

  const lines = reverseLines(storedLines);
  assertBalanced(lines);

  return lines;
}

export type EntryDocumentType = DocumentType | "allocation";

export type RecordEntryArgs =
  | {
      kind: "post";
      document: { id: string; posting: DocumentPosting | AllocationPosting };
      entryDate: string;
      narration: string;
    }
  | {
      kind: "reverse";
      document: { id: string; type: EntryDocumentType };
      entryDate: string;
      narration: string;
    };

// The only call Billing makes into General Accounting. A post runs the document
// type's posting function; a reverse swaps the stored lines of the post entry and
// never re-runs the posting function, rates or mappings.
export async function recordEntry(
  tx: DbTransaction,
  scope: Scope,
  args: RecordEntryArgs,
): Promise<void> {
  let lines: JournalLineInput[];
  let document: { id: string; type: EntryDocumentType };
  let reversesEntryId: string | null = null;

  if (args.kind === "post") {
    const { posting } = args.document;
    document = { id: args.document.id, type: posting.type };

    if (posting.type === "journal" || posting.type === "openingBalance") {
      lines = postJournal(posting);
    } else {
      // All of them, not only the keys this posting needs: at most 18 rows on one partial
      // index, and each posting function stays the only list of its keys.
      const systemRows = await tx
        .select({ id: accounts.id, systemKey: accounts.systemKey })
        .from(accounts)
        .where(and(eq(accounts.orgId, scope.orgId), isNotNull(accounts.systemKey)));

      const byKey: SystemAccounts = new Map(systemRows.map((row) => [row.systemKey!, row.id]));

      switch (posting.type) {
        case "receipt":
          lines = postReceipt(posting, byKey);
          break;
        case "payment":
          lines = postPayment(posting, byKey);
          break;
        case "invoice":
          lines = postInvoice(posting, byKey);
          break;
        case "allocation":
          lines = postAllocation(posting, byKey);
          break;
        default:
          posting satisfies never;
          throw new Error("Unsupported posting");
      }
    }

    assertBalanced(lines);
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
    lines = reversalOf(postLine.entryId, storedLines);
  }

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

// Reverses stored entries by id in a fixed number of statements: one read of their
// lines, one header insert, one line insert. Same posting boundary and same
// validation as a single `recordEntry` reverse; no posting function re-runs.
export async function reverseEntries(
  tx: DbTransaction,
  scope: Scope,
  entryIds: readonly string[],
  meta: { entryDate: string; narration: string },
): Promise<void> {
  if (entryIds.length === 0) {
    return;
  }

  const storedLines = await tx
    .select({
      entryId: journalLines.entryId,
      documentType: journalEntries.documentType,
      documentId: journalEntries.documentId,
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
    .where(and(eq(journalLines.orgId, scope.orgId), inArray(journalLines.entryId, [...entryIds])))
    .orderBy(journalLines.entryId, journalLines.id);

  const byEntry = new Map<string, typeof storedLines>();

  for (const line of storedLines) {
    const group = byEntry.get(line.entryId);

    if (group) {
      group.push(line);
    } else {
      byEntry.set(line.entryId, [line]);
    }
  }

  const entryRows: (typeof journalEntries.$inferInsert)[] = [];
  const lineRows: (typeof journalLines.$inferInsert)[] = [];

  for (const reversedEntryId of entryIds) {
    const stored = byEntry.get(reversedEntryId) ?? [];
    const lines = reversalOf(reversedEntryId, stored);

    const entryId = Bun.randomUUIDv7();

    entryRows.push({
      id: entryId,
      orgId: scope.orgId,
      documentType: stored[0]!.documentType,
      documentId: stored[0]!.documentId,
      kind: "reverse",
      reversesEntryId: reversedEntryId,
      entryDate: meta.entryDate,
      narration: meta.narration,
      createdBy: scope.userId,
    });

    for (const line of lines) {
      lineRows.push({ id: Bun.randomUUIDv7(), orgId: scope.orgId, entryId, ...line });
    }
  }

  await tx.insert(journalEntries).values(entryRows);
  await tx.insert(journalLines).values(lineRows);
}
