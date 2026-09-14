import type { DbTransaction } from "@accly/db";
import type { SupplyClass } from "@accly/db/schema/accounts";
import { documentLines } from "@accly/db/schema/document-lines";
import { documents, type PrintSnapshot } from "@accly/db/schema/documents";
import { organizationSettings } from "@accly/db/schema/organization-settings";
import { parties } from "@accly/db/schema/parties";
import { paymentMethods } from "@accly/db/schema/payment-methods";
import { tdsDeductions } from "@accly/db/schema/tds-deductions";
import { ORPCError } from "@orpc/server";
import { and, eq, sql } from "drizzle-orm";

import { businessDate } from "../lib/business-date";
import { badRequest } from "../lib/conflict";
import type { Scope } from "../lib/procedures/factory";
import { financialYearOf, postNumbered } from "./numbering";
import { reversePartyLedgerLines, writePartyLedgerLine } from "./party-ledger";
import { recordEntry, type DocumentPosting } from "./posting";

type DocumentNumbering = {
  prefix: string;
  fiscalYearStartMonth: number;
};

// The Payment Method's account and name come from the locked read in `postDocument`.
type WithoutMethod<T> = T extends unknown ? Omit<T, "methodAccountId"> : never;

export type PostDocumentInput = {
  documentDate: string;
  paymentMethodId: string;
  reference: string | null;
  narration: string | null;
  affectsTax: boolean;
  printSnapshot: Omit<PrintSnapshot, "paymentMethod">;
  lineDescription: string;
  posting: WithoutMethod<DocumentPosting>;
};

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

export async function postDocument(
  tx: DbTransaction,
  scope: Scope,
  numbering: DocumentNumbering,
  input: PostDocumentInput,
): Promise<{ id: string; number: string }> {
  if (
    input.posting.type === "receipt" &&
    input.posting.settlementKind === "advance" &&
    input.posting.advanceSupply === "taxableService"
  ) {
    throw badRequest(
      "ADVANCE_TAX_UNSUPPORTED",
      "A taxable service advance needs GST advance documents, which are not available yet.",
    );
  }

  // FOR SHARE: concurrent posts share the row, while an archive waits for them to
  // commit, so no document posts against a method archived mid-transaction.
  const [method] = await tx
    .select({ name: paymentMethods.name, accountId: paymentMethods.accountId })
    .from(paymentMethods)
    .where(
      and(
        eq(paymentMethods.orgId, scope.orgId),
        eq(paymentMethods.id, input.paymentMethodId),
        eq(paymentMethods.active, true),
      ),
    )
    .for("share");

  if (!method) throw badRequest("PAYMENT_METHOD_INVALID", "Choose an active payment method.");

  const posting = { ...input.posting, methodAccountId: method.accountId };
  const id = Bun.randomUUIDv7();
  const financialYear = financialYearOf(input.documentDate, numbering.fiscalYearStartMonth);

  // Written as a draft; postNumbered numbers and posts it in the last statement.
  await tx.insert(documents).values({
    id,
    orgId: scope.orgId,
    type: posting.type,
    state: "draft",
    series: numbering.prefix,
    financialYear,
    documentDate: input.documentDate,
    partyId: posting.partyId,
    exposureSide: posting.exposureSide,
    settlementKind: posting.settlementKind,
    advanceSupply:
      posting.type === "receipt" && posting.settlementKind === "advance"
        ? posting.advanceSupply
        : null,
    paymentMethodId: input.paymentMethodId,
    reference: input.reference,
    narration: input.narration,
    totalPaise: posting.amountPaise,
    affectsTax: input.affectsTax,
    printSnapshot: { ...input.printSnapshot, paymentMethod: method.name },
    createdBy: scope.userId,
  });

  await tx.insert(documentLines).values({
    id: Bun.randomUUIDv7(),
    orgId: scope.orgId,
    documentId: id,
    position: 1,
    kind: "account",
    accountId: posting.accountId,
    description: input.lineDescription,
    amountPaise: posting.amountPaise,
  });

  if (posting.settlementKind === "advance") {
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

  await recordEntry(tx, scope, {
    kind: "post",
    document: { id, posting },
    entryDate: input.documentDate,
    narration: input.narration ?? input.lineDescription,
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

// One conditional update cancels the document, so a second cancel or a foreign id is a
// CONFLICT; the reversal is dated at cancellation and swaps the stored lines.
export async function reverseDocument(
  tx: DbTransaction,
  scope: Scope,
  timeZone: string,
  type: DocumentPosting["type"],
  documentId: string,
  reason: string,
): Promise<typeof documents.$inferSelect> {
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
        eq(documents.type, type),
        eq(documents.state, "posted"),
      ),
    )
    .returning();

  if (!cancelled) {
    throw new ORPCError("CONFLICT", { message: "This document is not posted." });
  }

  const entryDate = businessDate(cancelledAt, timeZone);
  await reversePartyLedgerLines(tx, scope.orgId, documentId, entryDate);
  await recordEntry(tx, scope, {
    kind: "reverse",
    document: { id: documentId, type },
    entryDate,
    narration: reason,
  });

  return cancelled;
}
