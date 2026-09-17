import type { DbTransaction } from "@accly/db";
import { allocations } from "@accly/db/schema/allocations";
import type { SupplyClass } from "@accly/db/schema/accounts";
import { documentLines } from "@accly/db/schema/document-lines";
import { documents, type PrintSnapshot } from "@accly/db/schema/documents";
import { journalEntries } from "@accly/db/schema/journal-entries";
import { organizationSettings } from "@accly/db/schema/organization-settings";
import { parties } from "@accly/db/schema/parties";
import { paymentMethods } from "@accly/db/schema/payment-methods";
import { tdsDeductions } from "@accly/db/schema/tds-deductions";
import { ORPCError } from "@orpc/server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { businessDate } from "../lib/business-date";
import { badRequest, impossible } from "../lib/conflict";
import type { Scope } from "../lib/procedures/factory";
import { activeAllocationsOf, applyAllocations } from "./allocations";
import { financialYearOf, postNumbered } from "./numbering";
import { reversePartyLedgerLines, writePartyLedgerLine } from "./party-ledger";
import { recordEntry, type DocumentPosting } from "./posting";

export type DocumentNumbering = {
  prefix: string;
  fiscalYearStartMonth: number;
};

// A Receipt or Payment names its Payment Method; `postDocument` locks the method and
// swaps in its account. An Invoice (and later a Journal) has none.
type Draftable<T> = T extends { methodAccountId: string }
  ? Omit<T, "methodAccountId"> & { paymentMethodId: string }
  : T;

export type PostDocumentLine = {
  kind: "item" | "account";
  accountId: string | null;
  description: string;
  amountPaise: bigint;
  itemId: string | null;
  hsnSac: string | null;
  unit: string | null;
  quantity: number | null;
  unitPricePaise: bigint | null;
  taxRateId: string | null;
  cgstPaise: bigint;
  sgstPaise: bigint;
  igstPaise: bigint;
};

export type PostDocumentInput = {
  documentDate: string;
  dueDate: string | null;
  placeOfSupplyStateCode: string | null;
  reference: string | null;
  narration: string | null;
  affectsTax: boolean;
  printSnapshot: Omit<PrintSnapshot, "paymentMethod">;
  lines: readonly PostDocumentLine[];
  posting: Draftable<DocumentPosting>;
  draft: { id: string; version: number } | null;
};

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
  party:
    | Pick<
        typeof parties.$inferSelect,
        "name" | "addressLine1" | "addressLine2" | "city" | "pinCode" | "gstin" | "pan"
      >
    | undefined
    | null,
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

  if (input.posting.type === "invoice") {
    posting = input.posting;
  } else {
    // FOR SHARE: concurrent posts share the row, while an archive waits for them to
    // commit, so no document posts against a method archived mid-transaction.
    const [method] = await tx
      .select({ name: paymentMethods.name, accountId: paymentMethods.accountId })
      .from(paymentMethods)
      .where(
        and(
          eq(paymentMethods.orgId, scope.orgId),
          eq(paymentMethods.id, input.posting.paymentMethodId),
          eq(paymentMethods.active, true),
        ),
      )
      .for("share");

    if (!method) {
      throw badRequest("PAYMENT_METHOD_INVALID", "Choose an active payment method.");
    }

    paymentMethodId = input.posting.paymentMethodId;
    paymentMethodName = method.name;
    posting = { ...input.posting, methodAccountId: method.accountId };
  }

  const financialYear = financialYearOf(input.documentDate, numbering.fiscalYearStartMonth);
  const roundOffPaise = posting.type === "invoice" ? posting.roundOffPaise : 0n;
  const settlementKind = posting.type === "invoice" ? null : posting.settlementKind;

  const header = {
    type: posting.type,
    state: "draft" as const,
    series: numbering.prefix,
    financialYear,
    documentDate: input.documentDate,
    dueDate: input.dueDate,
    placeOfSupplyStateCode: input.placeOfSupplyStateCode,
    partyId: posting.partyId,
    exposureSide: posting.exposureSide,
    settlementKind,
    advanceSupply,
    paymentMethodId,
    reference: input.reference,
    narration: input.narration,
    totalPaise: posting.amountPaise,
    roundOffPaise,
    affectsTax: input.affectsTax,
    printSnapshot: { ...input.printSnapshot, paymentMethod: paymentMethodName },
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

  return { draft, posting, financialYear };
}

export async function postDocument(
  tx: DbTransaction,
  scope: Scope,
  numbering: DocumentNumbering,
  input: PostDocumentInput,
): Promise<{ id: string; number: string }> {
  const {
    draft: { id },
    posting,
    financialYear,
  } = await writeDraft(tx, scope, numbering, input);

  if (posting.type === "receipt" && posting.settlementKind === "against") {
    await applyAllocations(tx, scope, {
      sourceDocumentId: id,
      sourceState: "draft",
      targets: posting.allocations,
      entryDate: input.documentDate,
    });
  }

  if (posting.type === "invoice") {
    await writePartyLedgerLine(tx, scope.orgId, {
      partyId: posting.partyId,
      documentId: id,
      side: "receivable",
      kind: "post",
      amountPaise: posting.amountPaise,
      entryDate: input.documentDate,
    });
  } else if (
    posting.settlementKind === "advance" ||
    (posting.type === "receipt" && posting.settlementKind === "against")
  ) {
    await writePartyLedgerLine(tx, scope.orgId, {
      partyId: posting.partyId,
      documentId: id,
      side: posting.exposureSide,
      kind: "post",
      // Party statements are positive when the party owes the organization.
      amountPaise: posting.exposureSide === "payable" ? posting.amountPaise : -posting.amountPaise,
      entryDate: input.documentDate,
    });
  }

  if (posting.type === "payment" && posting.tds !== null) {
    await tx.insert(tdsDeductions).values({
      id: Bun.randomUUIDv7(),
      orgId: scope.orgId,
      documentId: id,
      tdsSectionId: posting.tds.sectionId,
      amountPaise: posting.tds.amountPaise,
    });
  }

  const [firstLine] = input.lines;

  if (!firstLine) throw impossible(`document ${id} has no lines`);

  await recordEntry(tx, scope, {
    kind: "post",
    document: { id, posting },
    entryDate: input.documentDate,
    narration: input.narration ?? firstLine.description,
  });

  const number = await postNumbered(
    tx,
    scope.orgId,
    id,
    posting.type,
    financialYear,
    numbering.prefix,
  );

  return { id, number };
}

// The state change runs first: its row lock serializes this cancel with an apply or
// reverse that locks the same document, so the allocations read after it are current.
export async function reverseDocument(
  tx: DbTransaction,
  scope: Scope,
  timeZone: string,
  type: DocumentPosting["type"],
  documentId: string,
  reason: string,
): Promise<typeof documents.$inferSelect> {
  const cancelledAt = new Date();
  const entryDate = businessDate(cancelledAt, timeZone);

  const [cancelled] = await tx
    .update(documents)
    .set({ state: "cancelled", cancelledAt, updatedAt: cancelledAt })
    .where(
      and(
        eq(documents.orgId, scope.orgId),
        eq(documents.id, documentId),
        eq(documents.type, type),
        eq(documents.state, "posted"),
      ),
    )
    .returning();

  if (!cancelled) {
    throw new ORPCError("CONFLICT", { message: "This document is not posted." });
  }

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
    .select({ allocationId: allocations.id })
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

  for (const entry of unreversedAllocationEntries) {
    await recordEntry(tx, scope, {
      kind: "reverse",
      document: { id: entry.allocationId, type: "allocation" },
      entryDate,
      narration: reason,
    });
  }

  await reversePartyLedgerLines(tx, scope.orgId, documentId, entryDate);
  await recordEntry(tx, scope, {
    kind: "reverse",
    document: { id: documentId, type },
    entryDate,
    narration: reason,
  });

  return cancelled;
}
