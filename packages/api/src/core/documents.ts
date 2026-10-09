import type { DbTransaction } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { type SupplyClass } from "@accly/db/schema/account-kinds";
import { allocations } from "@accly/db/schema/allocations";
import { documentLines, type AdjustmentKind } from "@accly/db/schema/document-lines";
import { type EntrySide } from "@accly/db/schema/entry-sides";
import { documents, type PrintSnapshot } from "@accly/db/schema/documents";
import { journalEntries } from "@accly/db/schema/journal-entries";
import { organizationSettings } from "@accly/db/schema/organization-settings";
import { parties } from "@accly/db/schema/parties";
import { paymentMethods } from "@accly/db/schema/payment-methods";
import { tdsDeductions } from "@accly/db/schema/tds-deductions";
import { ORPCError } from "@orpc/server";
import { and, eq, inArray, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { badRequest, impossible } from "../lib/conflict";
import { insertChunks } from "../lib/insert-chunks";
import type { Scope } from "../lib/procedures/factory";
import {
  activeAllocationsOf,
  applyAllocations,
  lockDocuments,
  settlementPaise,
  type AllocationPair,
  type AllocationTarget,
} from "./allocations";
import { documentRole } from "./document-roles";
import { assertPeriodOpen } from "./locks";
import { sumPaise } from "./money";
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
  /** An Invoice line's Item MRP; no other line has one. */
  mrpPaise: bigint | null;
  taxRateId: string | null;
  itcEligible: boolean | null;
  sourceLineId: string | null;
  adjustmentKind: AdjustmentKind | null;
  tdsSectionId?: string | null;
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

/**
 * A purchase's posting legs: eligible GST goes to input tax, and ineligible GST is
 * cost on the line's own account. Bills and debit notes share it.
 */
export function purchaseLegs(lines: readonly PostDocumentLine[]) {
  const eligible = lines.filter((line) => line.itcEligible);

  return {
    lines: lines.flatMap((line) => {
      if (!line.accountId) throw impossible("a purchase line has no account");

      const amountPaise =
        line.amountPaise +
        (line.itcEligible ? 0n : line.cgstPaise + line.sgstPaise + line.igstPaise);

      return amountPaise > 0n ? [{ accountId: line.accountId, amountPaise }] : [];
    }),
    cgstPaise: sumPaise(eligible.map((line) => line.cgstPaise)),
    sgstPaise: sumPaise(eligible.map((line) => line.sgstPaise)),
    igstPaise: sumPaise(eligible.map((line) => line.igstPaise)),
  };
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
    mrpPaise: null,
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

function documentAddress(
  address: string | null,
  city: string | null,
  pinCode: string | null,
): string {
  return [address, [city, pinCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

export function organizationSnapshot(
  settings: Pick<
    typeof organizationSettings.$inferSelect,
    "legalName" | "address" | "city" | "pinCode" | "gstin" | "pan"
  >,
): PrintSnapshot["organization"] {
  return {
    legalName: settings.legalName,
    address: documentAddress(settings.address, settings.city, settings.pinCode),
    gstin: settings.gstin,
    pan: settings.pan,
  };
}

export function partySnapshot(
  party: Pick<
    typeof parties.$inferSelect,
    "name" | "address" | "city" | "pinCode" | "stateCode" | "gstin" | "pan"
  > | null,
): PrintSnapshot["party"] {
  if (!party) return null;

  return {
    name: party.name,
    address: documentAddress(party.address, party.city, party.pinCode),
    stateCode: party.stateCode,
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
  // Only a posting that can hold money as an advance carries a supply.
  const advanceSupply = "advanceSupply" in input.posting ? input.posting.advanceSupply : null;

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

  // An imported Opening Balance can have 5,000 lines.
  const lines = input.lines.map((line, index) => ({
    id: Bun.randomUUIDv7(),
    orgId: scope.orgId,
    documentId: draft.id,
    position: index + 1,
    ...line,
  }));

  for (const chunk of insertChunks(lines)) await tx.insert(documentLines).values(chunk);

  if (posting.type === "bill" || posting.type === "debitNote") {
    if (posting.tdsPaise > 0n && !input.tdsSectionId) {
      throw impossible(`${posting.type} ${draft.id} with TDS has no section`);
    }

    // A note that reverses no TDS records no deduction, so registers skip it.
    if (input.tdsSectionId && (posting.type === "bill" || posting.tdsPaise > 0n)) {
      const deduction = {
        tdsSectionId: input.tdsSectionId,
        basePaise: sumPaise(input.lines.map((line) => line.amountPaise)),
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
  // One cutover: business sits after it, whichever of the two posts first (D3).
  if (input.posting.type === "openingBalance") {
    const [business] = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.orgId, scope.orgId),
          eq(documents.state, "posted"),
          notInArray(documents.type, ["openingBalance", "openingClaim", "openingCredit"]),
          lte(documents.documentDate, input.documentDate),
        ),
      )
      .limit(1);

    if (business)
      throw badRequest(
        "OPENING_BALANCE_AFTER_BUSINESS",
        "Documents are already posted on or before this date. Choose an earlier opening date.",
      );
  } else {
    const [opening] = await tx
      .select({ documentDate: documents.documentDate })
      .from(documents)
      .where(
        and(
          eq(documents.orgId, scope.orgId),
          eq(documents.type, "openingBalance"),
          eq(documents.state, "posted"),
        ),
      )
      .limit(1);

    if (opening && input.documentDate <= opening.documentDate)
      throw badRequest(
        "BEFORE_OPENING_BALANCE",
        "Post new business after the Opening Balance date.",
      );
  }

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

  // A Journal can carry one receivables movement for each party; other documents
  // carry at most one party-ledger movement.
  const ledgers: { partyId: string; side: "receivable" | "payable"; amountPaise: bigint }[] = [];

  let pairs: AllocationPair[] = [];
  let journalPairs: Map<string, Map<string, bigint>> | null = null;
  let allowedSourceTypes: readonly ("creditNote" | "debitNote" | "payment")[] | undefined;

  const settles = (targets: readonly AllocationTarget[]) =>
    targets.map(({ documentId, amountPaise }) => ({
      sourceDocumentId: id,
      targetDocumentId: documentId,
      amountPaise,
    }));

  // A refund is the target: it pays out each credit it names.
  const refunds = (sources: readonly AllocationTarget[]) =>
    sources.map(({ documentId, amountPaise }) => ({
      sourceDocumentId: documentId,
      targetDocumentId: id,
      amountPaise,
    }));

  // With adjustments the claims absorb the whole settlement: nothing is left as an advance.
  const assertFullyAllocated = (
    allocated: readonly AllocationPair[],
    adjusted: boolean,
    settledPaise: bigint,
  ) => {
    if (adjusted && sumPaise(allocated.map((row) => row.amountPaise)) !== settledPaise) {
      throw badRequest(
        "ADJUSTMENT_UNALLOCATED",
        "Allocate the full settlement including adjustments.",
      );
    }
  };

  switch (posting.type) {
    case "invoice":
      ledgers.push({
        partyId: posting.partyId,
        side: "receivable",
        amountPaise: posting.amountPaise,
      });
      break;
    case "bill":
      ledgers.push({
        partyId: posting.partyId,
        side: "payable",
        amountPaise: -(posting.amountPaise - posting.tdsPaise),
      });
      break;
    case "creditNote":
    case "debitNote": {
      const settledPaise =
        posting.type === "debitNote" ? posting.amountPaise - posting.tdsPaise : posting.amountPaise;

      // A debit note that reverses only TDS leaves no supplier credit.
      if (settledPaise > 0n)
        ledgers.push(
          posting.type === "creditNote"
            ? { partyId: posting.partyId, side: "receivable", amountPaise: -settledPaise }
            : { partyId: posting.partyId, side: "payable", amountPaise: settledPaise },
        );

      // `note.post` locked the source; the note settles what remains of it.
      if (!input.againstDocumentId) throw impossible(`${posting.type} ${id} has no source`);

      const [source] = await tx
        .select({ outstandingPaise: settlementPaise(scope.orgId, "target", null).balancePaise })
        .from(documents)
        .where(and(eq(documents.orgId, scope.orgId), eq(documents.id, input.againstDocumentId)));

      if (!source) throw impossible(`${posting.type} ${id} source vanished`);

      const amountPaise =
        source.outstandingPaise < settledPaise ? source.outstandingPaise : settledPaise;

      if (amountPaise > 0n)
        pairs = [{ sourceDocumentId: id, targetDocumentId: input.againstDocumentId, amountPaise }];

      break;
    }

    case "receipt":
      if (posting.settlementKind === "advance") {
        ledgers.push({
          partyId: posting.partyId,
          side: "receivable",
          amountPaise: -posting.amountPaise,
        });
        // oxlint-disable-next-line accly/no-exposure-side-branch -- narrows the request type
      } else if (posting.exposureSide === "receivable") {
        const settledPaise =
          posting.amountPaise + sumPaise(posting.adjustments.map((row) => row.amountPaise));

        ledgers.push({ partyId: posting.partyId, side: "receivable", amountPaise: -settledPaise });
        pairs = settles(posting.allocations);
        assertFullyAllocated(pairs, posting.adjustments.length > 0, settledPaise);
        // oxlint-disable-next-line accly/no-exposure-side-branch -- narrows the request type
      } else if (posting.exposureSide === "payable") {
        ledgers.push({
          partyId: posting.partyId,
          side: "payable",
          amountPaise: -posting.amountPaise,
        });
        pairs = refunds(posting.sources);
        allowedSourceTypes = ["debitNote", "payment"];
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

      // oxlint-disable-next-line accly/no-exposure-side-branch -- narrows the request type
      if (posting.exposureSide === "receivable") {
        // A refund pays out credit notes; the router checked the amounts match.
        ledgers.push({
          partyId: posting.partyId,
          side: "receivable",
          amountPaise: posting.amountPaise,
        });
        pairs = refunds(posting.sources);
        allowedSourceTypes = ["creditNote"];
      } else if (posting.settlementKind === "against") {
        const settledPaise =
          posting.amountPaise + sumPaise(posting.writeOffs.map((row) => row.amountPaise));

        ledgers.push({ partyId: posting.partyId, side: "payable", amountPaise: settledPaise });
        pairs = settles(posting.allocations);
        assertFullyAllocated(pairs, posting.writeOffs.length > 0, settledPaise);
      } else {
        ledgers.push({
          partyId: posting.partyId,
          side: "payable",
          amountPaise: posting.amountPaise,
        });
      }

      break;
    case "journal": {
      const byParty = new Map<string, bigint>();
      journalPairs = new Map();

      for (const line of posting.lines) {
        if (line.systemKey !== "receivables") continue;

        if (!line.partyId) throw impossible(`journal ${id} has a receivables line without a party`);
        byParty.set(
          line.partyId,
          (byParty.get(line.partyId) ?? 0n) +
            (line.side === "debit" ? line.amountPaise : -line.amountPaise),
        );

        if (line.allocations.length > 0) {
          const partyPairs = journalPairs.get(line.partyId) ?? new Map<string, bigint>();

          for (const target of line.allocations) {
            partyPairs.set(
              target.documentId,
              (partyPairs.get(target.documentId) ?? 0n) + target.amountPaise,
            );
          }

          journalPairs.set(line.partyId, partyPairs);
        }
      }

      for (const [partyId, amountPaise] of byParty) {
        if (amountPaise !== 0n) ledgers.push({ partyId, side: "receivable", amountPaise });
      }

      break;
    }
  }

  for (const line of ledgers)
    await writePartyLedgerLine(tx, scope.orgId, {
      ...line,
      documentId: id,
      kind: "post",
      entryDate: input.documentDate,
    });

  if (journalPairs) {
    const targetIds = [...journalPairs.values()].flatMap((targets) => [...targets.keys()]);

    // Lock every target in id order before the per-party applies take their own locks.
    if (targetIds.length > 0) await lockDocuments(tx, scope.orgId, targetIds);

    for (const [partyId, targets] of journalPairs)
      await applyAllocations(tx, scope, settings, {
        pairs: [...targets].map(([targetDocumentId, amountPaise]) => ({
          sourceDocumentId: id,
          targetDocumentId,
          amountPaise,
        })),
        draftDocumentId: id,
        partyId,
      });
  } else if (pairs.length > 0) {
    await applyAllocations(tx, scope, settings, {
      pairs,
      draftDocumentId: id,
      allowedSourceTypes,
    });
  }

  const [firstLine] = input.lines;

  if (!firstLine) throw impossible(`document ${id} has no lines`);

  await recordEntry(tx, scope, {
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

  const entryDate = cancelled.documentDate;

  await assertPeriodOpen(tx, scope, settings, { entryDate, affectsTax: cancelled.affectsTax });

  const active = await activeAllocationsOf(tx, scope.orgId, [documentId]);

  const asTarget = active.filter((row) => row.targetDocumentId === documentId);

  if (asTarget.length > 0 && !documentRole(cancelled).refund) {
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

  // Refunds reverse allocations targeting them, restoring each source's credit.
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
        entryDate: row.entryDate,
        createdBy: scope.userId,
      })),
    );
  }

  const reversedEntry = alias(journalEntries, "reversed_entry");

  const unreversedAllocationEntries = await tx
    .select({ entryId: journalEntries.id, entryDate: allocations.entryDate })
    .from(journalEntries)
    .innerJoin(
      allocations,
      and(
        eq(allocations.orgId, scope.orgId),
        eq(allocations.id, journalEntries.documentId),
        // A refund reverses only its own applies; a release entry written when another
        // source's apply to it was reversed belongs to that source.
        or(
          eq(allocations.sourceDocumentId, documentId),
          asTarget.length > 0
            ? inArray(
                allocations.id,
                asTarget.map((row) => row.id),
              )
            : undefined,
        ),
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

  const [postEntry] = await tx
    .select({ entryId: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.orgId, scope.orgId),
        eq(journalEntries.documentType, cancelled.type),
        eq(journalEntries.documentId, documentId),
        eq(journalEntries.kind, "post"),
      ),
    );

  if (!postEntry) throw impossible(`document ${documentId} is missing its post journal entry`);

  const entriesByDate = new Map<string, string[]>([[entryDate, [postEntry.entryId]]]);

  for (const entry of unreversedAllocationEntries) {
    const entries = entriesByDate.get(entry.entryDate) ?? [];
    entries.push(entry.entryId);
    entriesByDate.set(entry.entryDate, entries);
  }

  for (const [date, entries] of entriesByDate)
    await reverseEntries(tx, scope, entries, { entryDate: date, narration: reason });

  await reversePartyLedgerLines(tx, scope.orgId, [documentId], entryDate);

  return cancelled;
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
        tdsSectionId: line.tdsSectionId,
        itemId: line.itemId,
        partyId: line.partyId,
        description: line.description,
        hsnSac: line.hsnSac,
        unit: line.unit,
        quantity: line.quantity,
        unitPricePaise: line.unitPricePaise,
        mrpPaise: line.mrpPaise,
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
