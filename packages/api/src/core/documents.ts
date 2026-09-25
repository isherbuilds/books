import type { DbTransaction } from "@accly/db";
import { accounts, type SupplyClass } from "@accly/db/schema/accounts";
import { allocations } from "@accly/db/schema/allocations";
import {
  documentLines,
  type AdjustmentKind,
  type EntrySide,
} from "@accly/db/schema/document-lines";
import { documents, type PrintSnapshot } from "@accly/db/schema/documents";
import { journalEntries } from "@accly/db/schema/journal-entries";
import { organizationSettings } from "@accly/db/schema/organization-settings";
import { parties } from "@accly/db/schema/parties";
import { paymentMethods } from "@accly/db/schema/payment-methods";
import { tdsDeductions } from "@accly/db/schema/tds-deductions";
import { taxRates } from "@accly/db/schema/tax-rates";
import { ORPCError } from "@orpc/server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { businessDate } from "../lib/business-date";
import { badRequest, impossible } from "../lib/conflict";
import type { Scope } from "../lib/procedures/factory";
import {
  activeAllocationsOf,
  applyAllocations,
  settlementPaise,
  type AllocationPair,
  type AllocationTarget,
} from "./allocations";
import { assertPeriodOpen } from "./locks";
import { financialYearOf, postNumbered } from "./numbering";
import { reversePartyLedgerLines, writePartyLedgerLine } from "./party-ledger";
import { recordEntry, reverseEntries, type DocumentPosting } from "./posting";

export type DocumentNumbering = {
  prefix: string;
  fiscalYearStartMonth: number;
};

// A Receipt or Payment names its Payment Method; `postDocument` locks the method and
// swaps in its account. An Invoice, Journal or Opening Balance has none.
type Draftable<T> = T extends { methodAccountId: string }
  ? Omit<T, "methodAccountId"> & { paymentMethodId: string }
  : T;

export type PostDocumentLine = {
  kind: "item" | "account";
  accountId: string | null;
  description: string;
  amountPaise: bigint;
  discountPaise: bigint;
  entrySide: EntrySide | null;
  partyId: string | null;
  itemId: string | null;
  hsnSac: string | null;
  unit: string | null;
  quantity: number | null;
  unitPricePaise: bigint | null;
  taxRateId: string | null;
  itcEligible: boolean | null;
  sourceLineId: string | null;
  adjustmentKind: AdjustmentKind | null;
  cgstPaise: bigint;
  sgstPaise: bigint;
  igstPaise: bigint;
};

export type PostDocumentInput = {
  documentDate: string;
  dueDate: string | null;
  placeOfSupplyStateCode: string | null;
  intraState?: boolean;
  reference: string | null;
  narration: string | null;
  discountPaise: bigint;
  againstDocumentId: string | null;
  tdsSectionId?: string | null;
  affectsTax: boolean;
  printSnapshot: Omit<PrintSnapshot, "paymentMethod"> | null;
  lines: readonly PostDocumentLine[];
  posting: Draftable<DocumentPosting>;
  draft: { id: string; version: number } | null;
};

function sumPaise(rows: readonly { amountPaise: bigint }[]): bigint {
  return rows.reduce((sum, row) => sum + row.amountPaise, 0n);
}

export function accountLine(
  accountId: string | null,
  description: string,
  amountPaise: bigint,
): PostDocumentLine {
  return {
    kind: "account",
    accountId,
    description,
    amountPaise,
    discountPaise: 0n,
    itcEligible: null,
    sourceLineId: null,
    adjustmentKind: null,
    entrySide: null,
    partyId: null,
    itemId: null,
    hsnSac: null,
    unit: null,
    quantity: null,
    unitPricePaise: null,
    taxRateId: null,
    cgstPaise: 0n,
    sgstPaise: 0n,
    igstPaise: 0n,
  };
}

/** A posted document's number; posting assigns it, so a missing one breaks an invariant. */
export function postedNumber(number: string | null, documentId: string): string {
  if (number === null) throw impossible(`posted document ${documentId} has no number`);

  return number;
}

export function receiptTax(
  gstin: string | null,
  supplyClass: SupplyClass | null,
): { refused: boolean; affectsTax: boolean } {
  const registered = gstin !== null;

  return {
    refused: registered && supplyClass === "taxable",
    affectsTax: registered && supplyClass !== null && supplyClass !== "notASupply",
  };
}

/**
 * A direct Receipt's place of supply. Received over the counter or from an unregistered
 * recipient, a supply is made where the party is on record, else where the business is
 * (IGST Act s. 10 and 12), as ERPNext defaults it from the address.
 */
export function receiptSupply(
  partyStateCode: string | null,
  orgStateCode: string,
): { placeOfSupplyStateCode: string; intraState: boolean } {
  const placeOfSupplyStateCode = partyStateCode ?? orgStateCode;

  return { placeOfSupplyStateCode, intraState: placeOfSupplyStateCode === orgStateCode };
}

function addressLine(
  addressLine1: string | null,
  addressLine2: string | null,
  city: string | null,
  pinCode: string | null,
): string {
  return [addressLine1, addressLine2, [city, pinCode].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
}

export function organizationSnapshot(
  settings: Pick<
    typeof organizationSettings.$inferSelect,
    "legalName" | "addressLine1" | "addressLine2" | "city" | "pinCode" | "gstin" | "pan"
  >,
): PrintSnapshot["organization"] {
  return {
    legalName: settings.legalName,
    address: addressLine(
      settings.addressLine1,
      settings.addressLine2,
      settings.city,
      settings.pinCode,
    ),
    gstin: settings.gstin,
    pan: settings.pan,
  };
}

export function partySnapshot(
  party: Pick<
    typeof parties.$inferSelect,
    "name" | "addressLine1" | "addressLine2" | "city" | "pinCode" | "gstin" | "pan"
  > | null,
): PrintSnapshot["party"] {
  if (!party) return null;

  return {
    name: party.name,
    address: addressLine(party.addressLine1, party.addressLine2, party.city, party.pinCode),
    gstin: party.gstin,
    pan: party.pan,
  };
}

type WrittenDraft = {
  draft: { id: string; version: number };
  posting: DocumentPosting;
  financialYear: string;
};

/** Creates the draft, or replaces it when `input.draft` still names its version. */
export async function writeDraft(
  tx: DbTransaction,
  scope: Scope,
  numbering: DocumentNumbering,
  input: PostDocumentInput,
): Promise<WrittenDraft> {
  // The router stores a supply only for money held as an advance.
  const advanceSupply =
    input.posting.type === "receipt" && input.posting.settlementKind !== "direct"
      ? input.posting.advanceSupply
      : null;

  if (advanceSupply === "taxableService") {
    throw badRequest(
      "ADVANCE_TAX_UNSUPPORTED",
      "A taxable service advance needs GST advance documents, which are not available yet.",
    );
  }

  let posting: DocumentPosting;
  let paymentMethodId: string | null = null;
  let paymentMethodName: string | null = null;

  if (input.posting.type !== "receipt" && input.posting.type !== "payment") {
    posting = input.posting;
  } else {
    // FOR SHARE on the method and its money account: concurrent posts share the rows,
    // while an archive of either waits for them to commit. The account is checked
    // too because restoring a method never re-checks the account it lands in.
    const [method] = await tx
      .select({ name: paymentMethods.name, accountId: paymentMethods.accountId })
      .from(paymentMethods)
      .innerJoin(
        accounts,
        and(
          eq(accounts.orgId, scope.orgId),
          eq(accounts.id, paymentMethods.accountId),
          eq(accounts.active, true),
        ),
      )
      .where(
        and(
          eq(paymentMethods.orgId, scope.orgId),
          eq(paymentMethods.id, input.posting.paymentMethodId),
          eq(paymentMethods.active, true),
        ),
      )
      .for("share");

    if (!method) {
      throw badRequest(
        "PAYMENT_METHOD_INVALID",
        "Choose an active payment method whose account is active.",
      );
    }

    paymentMethodId = input.posting.paymentMethodId;
    paymentMethodName = method.name;
    posting = { ...input.posting, methodAccountId: method.accountId };
  }

  if (
    (posting.type === "invoice" ||
      posting.type === "bill" ||
      posting.type === "creditNote" ||
      posting.type === "debitNote") &&
    input.printSnapshot === null
  ) {
    throw impossible(`${posting.type} print snapshot is missing`);
  }

  const financialYear = financialYearOf(input.documentDate, numbering.fiscalYearStartMonth);

  const postingHeader = (() => {
    switch (posting.type) {
      case "invoice":
      case "bill":
      case "creditNote":
      case "debitNote":
        return {
          partyId: posting.partyId,
          exposureSide: posting.exposureSide,
          settlementKind: null,
          advanceSupply: null,
          roundOffPaise: posting.roundOffPaise,
        };
      case "receipt":
      case "payment":
        return {
          partyId: posting.partyId,
          exposureSide: posting.exposureSide,
          settlementKind: posting.settlementKind,
          advanceSupply,
          roundOffPaise: 0n,
        };
      case "journal":
      case "openingBalance":
        return {
          partyId: null,
          exposureSide: null,
          settlementKind: null,
          advanceSupply: null,
          roundOffPaise: 0n,
        };
      default:
        posting satisfies never;
        throw new Error("Unsupported document posting");
    }
  })();

  const header = {
    type: posting.type,
    state: "draft" as const,
    series: numbering.prefix,
    financialYear,
    documentDate: input.documentDate,
    dueDate: input.dueDate,
    placeOfSupplyStateCode: input.placeOfSupplyStateCode,
    intraState: input.intraState ?? null,
    againstDocumentId: input.againstDocumentId,
    discountPaise: input.discountPaise,
    ...postingHeader,
    paymentMethodId,
    reference: input.reference,
    narration: input.narration,
    totalPaise: posting.amountPaise,
    affectsTax: input.affectsTax,
    printSnapshot:
      input.printSnapshot === null
        ? null
        : { ...input.printSnapshot, paymentMethod: paymentMethodName },
  };

  let draft: { id: string; version: number };

  if (input.draft === null) {
    const id = Bun.randomUUIDv7();

    const [created] = await tx
      .insert(documents)
      .values({ id, orgId: scope.orgId, ...header, createdBy: scope.userId })
      .returning({ id: documents.id, version: documents.version });

    if (!created) throw new Error("Draft insert returned no row");
    draft = created;
  } else {
    const [updated] = await tx
      .update(documents)
      .set({
        ...header,
        version: sql`${documents.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(documents.orgId, scope.orgId),
          eq(documents.id, input.draft.id),
          eq(documents.type, posting.type),
          eq(documents.state, "draft"),
          eq(documents.version, input.draft.version),
        ),
      )
      .returning({ id: documents.id, version: documents.version });

    if (!updated) {
      throw new ORPCError("CONFLICT", {
        message: "This draft changed. Reload it and try again.",
      });
    }

    draft = updated;
    await tx
      .delete(documentLines)
      .where(
        and(eq(documentLines.orgId, scope.orgId), eq(documentLines.documentId, input.draft.id)),
      );
  }

  await tx.insert(documentLines).values(
    input.lines.map((line, index) => ({
      id: Bun.randomUUIDv7(),
      orgId: scope.orgId,
      documentId: draft.id,
      position: index + 1,
      ...line,
    })),
  );

  if (posting.type === "bill") {
    if (posting.tdsPaise > 0n && !input.tdsSectionId) {
      throw impossible(`bill ${draft.id} with TDS has no section`);
    }

    if (input.tdsSectionId) {
      const deduction = {
        tdsSectionId: input.tdsSectionId,
        basePaise: input.lines.reduce((sum, line) => sum + line.amountPaise, 0n),
        amountPaise: posting.tdsPaise,
      };

      await tx
        .insert(tdsDeductions)
        .values({
          id: Bun.randomUUIDv7(),
          orgId: scope.orgId,
          documentId: draft.id,
          ...deduction,
        })
        .onConflictDoUpdate({
          target: [tdsDeductions.orgId, tdsDeductions.documentId],
          set: deduction,
        });
    } else if (input.draft) {
      await tx
        .delete(tdsDeductions)
        .where(and(eq(tdsDeductions.orgId, scope.orgId), eq(tdsDeductions.documentId, draft.id)));
    }
  }

  return { draft, posting, financialYear };
}

// The caller holds this settings row FOR SHARE (or stronger) in the same
// transaction before taking any document locks.
export async function postDocument(
  tx: DbTransaction,
  scope: Scope,
  settings: typeof organizationSettings.$inferSelect,
  prefix: string,
  input: PostDocumentInput,
): Promise<{ id: string; number: string }> {
  await assertPeriodOpen(tx, scope, settings, {
    entryDate: input.documentDate,
    affectsTax: input.affectsTax,
  });

  const {
    draft: { id },
    posting,
    financialYear,
  } = await writeDraft(
    tx,
    scope,
    { prefix, fiscalYearStartMonth: settings.financialYearStart },
    input,
  );

  // The party-ledger line and the allocations this posting makes. A direct settlement,
  // a Journal and an Opening Balance make neither.
  let ledger: { partyId: string; side: "receivable" | "payable"; amountPaise: bigint } | null =
    null;

  let pairs: AllocationPair[] = [];
  let requiredSourceType: "creditNote" | undefined;

  const settles = (targets: readonly AllocationTarget[]) =>
    targets.map(({ documentId, amountPaise }) => ({
      sourceDocumentId: id,
      targetDocumentId: documentId,
      amountPaise,
    }));

  // With adjustments the claims absorb the whole settlement: nothing is left as an advance.
  const assertFullyAllocated = (
    allocated: readonly AllocationPair[],
    adjusted: boolean,
    settledPaise: bigint,
  ) => {
    if (adjusted && sumPaise(allocated) !== settledPaise) {
      throw badRequest(
        "ADJUSTMENT_UNALLOCATED",
        "Allocate the full settlement including adjustments.",
      );
    }
  };

  switch (posting.type) {
    case "invoice":
      ledger = { partyId: posting.partyId, side: "receivable", amountPaise: posting.amountPaise };
      break;
    case "bill":
      ledger = {
        partyId: posting.partyId,
        side: "payable",
        amountPaise: -(posting.amountPaise - posting.tdsPaise),
      };
      break;
    case "creditNote":
    case "debitNote": {
      ledger =
        posting.type === "creditNote"
          ? { partyId: posting.partyId, side: "receivable", amountPaise: -posting.amountPaise }
          : { partyId: posting.partyId, side: "payable", amountPaise: posting.amountPaise };

      // `note.post` locked the source; the note settles what remains of it.
      if (!input.againstDocumentId) throw impossible(`${posting.type} ${id} has no source`);

      const [source] = await tx
        .select({ outstandingPaise: settlementPaise(scope.orgId, "target").balancePaise })
        .from(documents)
        .where(and(eq(documents.orgId, scope.orgId), eq(documents.id, input.againstDocumentId)));

      if (!source) throw impossible(`${posting.type} ${id} source vanished`);

      const amountPaise =
        source.outstandingPaise < posting.amountPaise
          ? source.outstandingPaise
          : posting.amountPaise;

      if (amountPaise > 0n)
        pairs = [{ sourceDocumentId: id, targetDocumentId: input.againstDocumentId, amountPaise }];

      break;
    }

    case "receipt":
      if (posting.settlementKind === "advance") {
        ledger = {
          partyId: posting.partyId,
          side: "receivable",
          amountPaise: -posting.amountPaise,
        };
      } else if (posting.settlementKind === "against") {
        const settledPaise = posting.amountPaise + sumPaise(posting.adjustments);

        ledger = { partyId: posting.partyId, side: "receivable", amountPaise: -settledPaise };
        pairs = settles(posting.allocations);
        assertFullyAllocated(pairs, posting.adjustments.length > 0, settledPaise);
      }

      break;
    case "payment":
      if (posting.tds !== null) {
        await tx.insert(tdsDeductions).values({
          id: Bun.randomUUIDv7(),
          orgId: scope.orgId,
          documentId: id,
          tdsSectionId: posting.tds.sectionId,
          basePaise: posting.amountPaise,
          amountPaise: posting.tds.amountPaise,
        });
      }

      if (posting.settlementKind === "direct") break;

      if (posting.exposureSide === "receivable") {
        // A refund pays out credit notes; the router checked the amounts match.
        ledger = { partyId: posting.partyId, side: "receivable", amountPaise: posting.amountPaise };
        pairs = posting.sources.map(({ documentId, amountPaise }) => ({
          sourceDocumentId: documentId,
          targetDocumentId: id,
          amountPaise,
        }));
        requiredSourceType = "creditNote";
      } else if (posting.settlementKind === "against") {
        const settledPaise = posting.amountPaise + sumPaise(posting.writeOffs);

        ledger = { partyId: posting.partyId, side: "payable", amountPaise: settledPaise };
        pairs = settles(posting.allocations);
        assertFullyAllocated(pairs, posting.writeOffs.length > 0, settledPaise);
      } else {
        ledger = { partyId: posting.partyId, side: "payable", amountPaise: posting.amountPaise };
      }

      break;
  }

  if (ledger)
    await writePartyLedgerLine(tx, scope.orgId, {
      ...ledger,
      documentId: id,
      kind: "post",
      entryDate: input.documentDate,
    });

  if (pairs.length > 0)
    await applyAllocations(tx, scope, {
      pairs,
      draftDocumentId: id,
      entryDate: input.documentDate,
      requiredSourceType,
    });

  const [firstLine] = input.lines;

  if (!firstLine) throw impossible(`document ${id} has no lines`);

  await recordEntry(tx, scope, {
    kind: "post",
    document: { id, posting },
    entryDate: input.documentDate,
    narration: input.narration ?? firstLine.description,
  });

  const number = await postNumbered(tx, scope.orgId, id, posting.type, financialYear, prefix);

  return { id, number };
}

// The caller holds settings FOR SHARE (or stronger) before this document update.
// The document's row lock then serializes cancellation with allocations. `types` lists
// what the id may be, so a note is cancelled without first reading its type.
export async function reverseDocument(
  tx: DbTransaction,
  scope: Scope,
  settings: typeof organizationSettings.$inferSelect,
  types: readonly DocumentPosting["type"][],
  documentId: string,
  reason: string,
): Promise<typeof documents.$inferSelect> {
  const cancelledAt = new Date();

  const [cancelled] = await tx
    .update(documents)
    .set({ state: "cancelled", cancelledAt, updatedAt: cancelledAt })
    .where(
      and(
        eq(documents.orgId, scope.orgId),
        eq(documents.id, documentId),
        inArray(documents.type, [...types]),
        eq(documents.state, "posted"),
      ),
    )
    .returning();

  if (!cancelled) {
    throw new ORPCError("CONFLICT", { message: "This document is not posted." });
  }

  if (cancelled.type === "invoice" || cancelled.type === "bill") {
    const noteType = cancelled.type === "invoice" ? "creditNote" : "debitNote";

    const notes = await tx
      .select({ id: documents.id, number: documents.number })
      .from(documents)
      .where(
        and(
          eq(documents.orgId, scope.orgId),
          eq(documents.againstDocumentId, documentId),
          eq(documents.type, noteType),
          eq(documents.state, "posted"),
        ),
      );

    if (notes.length > 0) {
      throw new ORPCError("CONFLICT", {
        message: `Cancel ${noteType === "creditNote" ? "credit note" : "debit note"} ${notes.map((row) => postedNumber(row.number, row.id)).join(", ")} first.`,
      });
    }
  }

  // Opening corrections belong to the cutover; ordinary cancellations belong to today.
  const entryDate =
    cancelled.type === "openingBalance"
      ? cancelled.documentDate
      : businessDate(cancelledAt, settings.timeZone);

  await assertPeriodOpen(tx, scope, settings, { entryDate, affectsTax: cancelled.affectsTax });

  const active = await activeAllocationsOf(tx, scope.orgId, [documentId]);
  const asTarget = active.filter((row) => row.targetDocumentId === documentId);

  if (asTarget.length > 0) {
    const sources = await tx
      .select({ id: documents.id, number: documents.number })
      .from(documents)
      .where(
        and(
          eq(documents.orgId, scope.orgId),
          inArray(
            documents.id,
            asTarget.map((row) => row.sourceDocumentId),
          ),
        ),
      );

    throw new ORPCError("CONFLICT", {
      message: `Reverse allocations from ${sources.map((row) => postedNumber(row.number, row.id)).join(", ")} first.`,
    });
  }

  // Every remaining row allocates from this document. Drizzle refuses an empty insert.
  if (active.length > 0) {
    await tx.insert(allocations).values(
      active.map((row) => ({
        id: Bun.randomUUIDv7(),
        orgId: scope.orgId,
        sourceDocumentId: row.sourceDocumentId,
        targetDocumentId: row.targetDocumentId,
        amountPaise: row.amountPaise,
        kind: "reverse" as const,
        reversesAllocationId: row.id,
        entryDate,
        createdBy: scope.userId,
      })),
    );
  }

  const reversedEntry = alias(journalEntries, "reversed_entry");

  const unreversedAllocationEntries = await tx
    .select({ entryId: journalEntries.id })
    .from(journalEntries)
    .innerJoin(
      allocations,
      and(
        eq(allocations.orgId, scope.orgId),
        eq(allocations.id, journalEntries.documentId),
        eq(allocations.sourceDocumentId, documentId),
      ),
    )
    .leftJoin(
      reversedEntry,
      and(
        eq(reversedEntry.orgId, scope.orgId),
        eq(reversedEntry.reversesEntryId, journalEntries.id),
      ),
    )
    .where(
      and(
        eq(journalEntries.orgId, scope.orgId),
        eq(journalEntries.documentType, "allocation"),
        eq(journalEntries.kind, "post"),
        isNull(reversedEntry.id),
      ),
    );

  await reverseEntries(
    tx,
    scope,
    unreversedAllocationEntries.map((entry) => entry.entryId),
    { entryDate, narration: reason },
  );

  await reversePartyLedgerLines(tx, scope.orgId, documentId, entryDate);
  await recordEntry(tx, scope, {
    kind: "reverse",
    document: { id: documentId, type: cancelled.type },
    entryDate,
    narration: reason,
  });

  return cancelled;
}

/** Lock a posted claim while resolving its note, and summarize all earlier posted notes. */
export async function noteSource(
  tx: DbTransaction,
  scope: Scope,
  sourceDocumentId: string,
  type: "creditNote" | "debitNote",
) {
  const expected = type === "creditNote" ? "invoice" : "bill";

  const [source] = await tx
    .select({
      id: documents.id,
      partyId: documents.partyId,
      documentDate: documents.documentDate,
      placeOfSupplyStateCode: documents.placeOfSupplyStateCode,
      intraState: documents.intraState,
      totalPaise: documents.totalPaise,
      affectsTax: documents.affectsTax,
    })
    .from(documents)
    .where(
      and(
        eq(documents.orgId, scope.orgId),
        eq(documents.id, sourceDocumentId),
        eq(documents.type, expected),
        eq(documents.state, "posted"),
      ),
    )
    .for("no key update");

  if (!source || !source.partyId || source.intraState === null)
    throw badRequest("NOTE_SOURCE_INVALID", "Choose a posted source document.");

  const lines = await tx
    .select({
      id: documentLines.id,
      accountId: documentLines.accountId,
      description: documentLines.description,
      hsnSac: documentLines.hsnSac,
      taxRateId: documentLines.taxRateId,
      rateBasisPoints: taxRates.rateBasisPoints,
      itcEligible: documentLines.itcEligible,
      amountPaise: documentLines.amountPaise,
      cgstPaise: documentLines.cgstPaise,
      sgstPaise: documentLines.sgstPaise,
      igstPaise: documentLines.igstPaise,
    })
    .from(documentLines)
    .leftJoin(
      taxRates,
      and(eq(taxRates.orgId, scope.orgId), eq(taxRates.id, documentLines.taxRateId)),
    )
    .where(
      and(eq(documentLines.orgId, scope.orgId), eq(documentLines.documentId, sourceDocumentId)),
    );

  const prior = await tx
    .select({
      sourceLineId: documentLines.sourceLineId,
      amountPaise: sql<bigint>`sum(${documentLines.amountPaise})::bigint`.mapWith(BigInt),
      cgstPaise: sql<bigint>`sum(${documentLines.cgstPaise})::bigint`.mapWith(BigInt),
      sgstPaise: sql<bigint>`sum(${documentLines.sgstPaise})::bigint`.mapWith(BigInt),
      igstPaise: sql<bigint>`sum(${documentLines.igstPaise})::bigint`.mapWith(BigInt),
    })
    .from(documentLines)
    .innerJoin(
      documents,
      and(
        eq(documents.orgId, scope.orgId),
        eq(documents.id, documentLines.documentId),
        eq(documents.type, type),
        eq(documents.state, "posted"),
        eq(documents.againstDocumentId, sourceDocumentId),
      ),
    )
    .where(
      and(
        eq(documentLines.orgId, scope.orgId),
        inArray(
          documentLines.sourceLineId,
          lines.map((line) => line.id),
        ),
      ),
    )
    .groupBy(documentLines.sourceLineId);

  const [total] = await tx
    .select({
      amountPaise: sql<bigint>`coalesce(sum(${documents.totalPaise}), 0)::bigint`.mapWith(BigInt),
    })
    .from(documents)
    .where(
      and(
        eq(documents.orgId, scope.orgId),
        eq(documents.type, type),
        eq(documents.againstDocumentId, sourceDocumentId),
        eq(documents.state, "posted"),
      ),
    );

  return {
    ...source,
    partyId: source.partyId,
    intraState: source.intraState,
    lines,
    prior,
    priorTotalPaise: total!.amountPaise,
  };
}

/** Cancel a posted invoice or bill and copy its editable header and lines into a draft. */
export async function amendDocument(
  tx: DbTransaction,
  scope: Scope,
  settings: typeof organizationSettings.$inferSelect,
  type: "invoice" | "bill",
  documentId: string,
  reason: string,
): Promise<{ id: string; version: number }> {
  const original = await reverseDocument(tx, scope, settings, [type], documentId, reason);

  const [draft] = await tx
    .insert(documents)
    .values({
      id: Bun.randomUUIDv7(),
      orgId: scope.orgId,
      type,
      state: "draft",
      series: original.series,
      financialYear: original.financialYear,
      documentDate: original.documentDate,
      dueDate: original.dueDate,
      placeOfSupplyStateCode: original.placeOfSupplyStateCode,
      intraState: original.intraState,
      partyId: original.partyId,
      exposureSide: original.exposureSide,
      reference: original.reference,
      narration: original.narration,
      amendedFromId: original.id,
      totalPaise: original.totalPaise,
      discountPaise: original.discountPaise,
      roundOffPaise: original.roundOffPaise,
      affectsTax: original.affectsTax,
      printSnapshot: original.printSnapshot,
      createdBy: scope.userId,
    })
    .returning({ id: documents.id, version: documents.version });

  if (!draft) throw impossible(`amended draft for ${documentId} was not inserted`);

  const lines = await tx
    .select()
    .from(documentLines)
    .where(and(eq(documentLines.orgId, scope.orgId), eq(documentLines.documentId, documentId)));

  if (lines.length > 0)
    await tx.insert(documentLines).values(
      lines.map((line) => ({
        id: Bun.randomUUIDv7(),
        orgId: scope.orgId,
        documentId: draft.id,
        position: line.position,
        kind: line.kind,
        accountId: line.accountId,
        entrySide: line.entrySide,
        adjustmentKind: line.adjustmentKind,
        itemId: line.itemId,
        partyId: line.partyId,
        description: line.description,
        hsnSac: line.hsnSac,
        unit: line.unit,
        quantity: line.quantity,
        unitPricePaise: line.unitPricePaise,
        taxRateId: line.taxRateId,
        itcEligible: line.itcEligible,
        cgstPaise: line.cgstPaise,
        sgstPaise: line.sgstPaise,
        igstPaise: line.igstPaise,
        amountPaise: line.amountPaise,
        discountPaise: line.discountPaise,
      })),
    );

  if (type === "bill") {
    const [tds] = await tx
      .select()
      .from(tdsDeductions)
      .where(and(eq(tdsDeductions.orgId, scope.orgId), eq(tdsDeductions.documentId, documentId)))
      .limit(1);

    if (tds)
      await tx.insert(tdsDeductions).values({
        id: Bun.randomUUIDv7(),
        orgId: scope.orgId,
        documentId: draft.id,
        tdsSectionId: tds.tdsSectionId,
        basePaise: tds.basePaise,
        amountPaise: tds.amountPaise,
      });
  }

  return draft;
}
