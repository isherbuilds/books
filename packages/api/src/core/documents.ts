import type { DbTransaction } from "@accly/db/counter";
import { documentLines } from "@accly/db/schema/document-lines";
import { documents, type PrintSnapshot } from "@accly/db/schema/documents";
import { journalEntries } from "@accly/db/schema/journal-entries";
import { and, eq, sql } from "drizzle-orm";

import { businessDate } from "../lib/business-date";
import type { Scope } from "../lib/procedures/factory";
import { assignNumber, financialYearOf } from "./numbering";
import { reversePartyLedgerLines, writePartyLedgerLine } from "./party-ledger";
import { recordEntry, type ReceiptPosting } from "./posting";

export type DocumentSettings = {
  fiscalYearStartMonth: number;
  receiptPrefix: string;
  timeZone: string;
};

export type PostDocumentInput = {
  documentDate: string;
  paymentMethodId: string;
  paymentMethodAccountId: string;
  reference: string | null;
  narration: string | null;
  affectsTax: boolean;
  printSnapshot: PrintSnapshot;
  lineDescription: string;
} & ReceiptPosting;

export class DocumentNotFoundError extends Error {}

export class DocumentAlreadyCancelledError extends Error {}

export async function postDocument(
  tx: DbTransaction,
  scope: Scope,
  settings: DocumentSettings,
  input: PostDocumentInput,
): Promise<{ documentId: string; entryId: string; number: string }> {
  const financialYear = financialYearOf(input.documentDate, settings.fiscalYearStartMonth);

  const number = await assignNumber(
    tx,
    scope.orgId,
    "receipt",
    financialYear,
    settings.receiptPrefix,
  );

  const documentId = Bun.randomUUIDv7();
  const postedAt = new Date();

  await tx.insert(documents).values({
    id: documentId,
    orgId: scope.orgId,
    type: "receipt",
    state: "posted",
    number,
    series: settings.receiptPrefix,
    financialYear,
    documentDate: input.documentDate,
    partyId: input.partyId,
    exposureSide: input.exposureSide,
    settlementKind: input.settlementKind,
    advanceSupply: input.settlementKind === "advance" ? input.advanceSupply : null,
    paymentMethodId: input.paymentMethodId,
    reference: input.reference,
    narration: input.narration,
    totalPaise: input.amountPaise,
    affectsTax: input.affectsTax,
    printSnapshot: input.printSnapshot,
    postedAt,
    createdBy: scope.userId,
  });

  await tx.insert(documentLines).values({
    id: Bun.randomUUIDv7(),
    orgId: scope.orgId,
    documentId,
    position: 1,
    kind: "account",
    accountId: input.incomeAccountId,
    description: input.lineDescription,
    amountPaise: input.amountPaise,
  });

  if (input.settlementKind === "advance") {
    await writePartyLedgerLine(tx, scope.orgId, {
      partyId: input.partyId,
      documentId,
      side: input.exposureSide,
      kind: "post",
      amountPaise: -input.amountPaise,
      entryDate: input.documentDate,
    });
  }

  const { entryId } = await recordEntry(tx, scope, {
    kind: "post",
    document: {
      id: documentId,
      type: "receipt",
      entryDate: input.documentDate,
      narration: input.narration ?? input.lineDescription,
      posting: input,
      paymentMethodAccountId: input.paymentMethodAccountId,
    },
  });

  return { documentId, entryId, number };
}

export async function reverseDocument(
  tx: DbTransaction,
  scope: Scope,
  settings: DocumentSettings,
  documentId: string,
  reason: string,
): Promise<{ entryId: string }> {
  const [document] = await tx
    .select({ id: documents.id, type: documents.type, state: documents.state })
    .from(documents)
    .where(
      and(
        eq(documents.orgId, scope.orgId),
        eq(documents.id, documentId),
        eq(documents.type, "receipt"),
      ),
    )
    .limit(1)
    .for("update");

  if (!document) throw new DocumentNotFoundError("Document not found");

  if (document.state === "cancelled") {
    throw new DocumentAlreadyCancelledError("Document is already cancelled");
  }

  if (document.state !== "posted") {
    throw new Error(`Document ${documentId} is not posted`);
  }

  const entryDate = businessDate(new Date(), settings.timeZone);
  await reversePartyLedgerLines(tx, scope.orgId, documentId, entryDate);

  const [postEntry] = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.orgId, scope.orgId),
        eq(journalEntries.documentType, document.type),
        eq(journalEntries.documentId, documentId),
        eq(journalEntries.kind, "post"),
      ),
    )
    .limit(1);

  if (!postEntry) throw new Error(`Document ${documentId} is missing its post journal entry`);

  const result = await recordEntry(tx, scope, {
    kind: "reverse",
    document: { id: documentId, type: document.type },
    reversesEntryId: postEntry.id,
    entryDate,
    narration: reason,
  });

  const cancelledAt = new Date();

  const [cancelled] = await tx
    .update(documents)
    .set({
      state: "cancelled",
      cancelledAt,
      updatedAt: cancelledAt,
      version: sql`${documents.version} + 1`,
    })
    .where(
      and(
        eq(documents.orgId, scope.orgId),
        eq(documents.id, documentId),
        eq(documents.type, "receipt"),
      ),
    )
    .returning({ id: documents.id });

  if (!cancelled) throw new Error(`Locked document ${documentId} disappeared during cancellation`);

  return result;
}
