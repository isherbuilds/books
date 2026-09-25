import { db, type DbTransaction } from "@accly/db";
import { documentLines } from "@accly/db/schema/document-lines";
import { documents } from "@accly/db/schema/documents";
import type { organizationSettings } from "@accly/db/schema/organization-settings";
import { taxRates } from "@accly/db/schema/tax-rates";
import { tdsDeductions } from "@accly/db/schema/tds-deductions";
import { tdsSections } from "@accly/db/schema/tds-sections";
import { ORPCError } from "@orpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { settlementPaise } from "../core/allocations";
import {
  documentTotals,
  organizationSnapshot,
  partySnapshot,
  postDocument,
  purchaseLegs,
  taxTotals,
  writeDraft,
  type PostDocumentInput,
  type PostDocumentLine,
} from "../core/documents";
import { formatDecimal } from "../core/money";
import { computeTds, type BillPosting } from "../core/posting";
import { computeTax } from "../core/tax";
import { effectiveOn, ratesByCode } from "../core/tax-schedule";
import { postableAccounts } from "../lib/accounts";
import { businessDate } from "../lib/business-date";
import { badRequest } from "../lib/conflict";
import { activeParty } from "../lib/parties";
import type { Scope } from "../lib/procedures/factory";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import {
  dateOnly,
  draftToken,
  indianStateCode,
  money,
  optionalHsnSac,
  optionalTaxCode,
  orderedPeriod,
  reason,
  settlementPostFields,
} from "../lib/schemas";
import {
  allocationsOf,
  amendClaim,
  cancelDocument,
  claimListFields,
  discardDraft,
  documentSettlement,
  listClaims,
  orgSettings,
  orgTimeZone,
  printedPartyName,
} from "../lib/settlements";

const billFields = {
  partyId: z.uuid(),
  documentDate: dateOnly.optional(),
  dueDate: dateOnly.optional(),
  reference: z.string().trim().max(40).optional(),
  placeOfSupplyStateCode: indianStateCode.optional(),
  tdsSectionId: z.uuid().optional(),
  narration: settlementPostFields.narration,
  lines: z
    .array(
      z.object({
        accountId: z.uuid(),
        description: z.string().trim().min(1).max(200),
        amount: money,
        taxCode: optionalTaxCode,
        hsnSac: optionalHsnSac,
        itcEligible: z.boolean(),
      }),
    )
    .min(1)
    .max(100),
};

type BillFields = z.output<z.ZodObject<typeof billFields>>;

async function resolveBill(
  executor: typeof db | DbTransaction,
  scope: Scope,
  input: BillFields,
  settings: typeof organizationSettings.$inferSelect,
): Promise<PostDocumentInput> {
  const documentDate = input.documentDate ?? businessDate(new Date(), settings.timeZone);

  if (input.dueDate && input.dueDate < documentDate) {
    throw badRequest("DUE_DATE_BEFORE_DOCUMENT", "Due date cannot be before the bill date.");
  }

  const party = await activeParty(executor, scope.orgId, input.partyId);

  if (!party) throw badRequest("PARTY_INVALID", "Choose an active party in this organization.");

  if (!party.stateCode)
    throw badRequest("PARTY_STATE_REQUIRED", "Record the supplier's state before posting a bill.");

  const ids = [...new Set(input.lines.map((line) => line.accountId))];
  const storedAccounts = await postableAccounts(executor, scope.orgId, ids, ["expense", "asset"]);

  if (storedAccounts.length !== ids.length) {
    throw badRequest(
      "ACCOUNT_INVALID",
      "Choose active expense or asset leaves that are not system accounts.",
    );
  }

  const codes = [...new Set(input.lines.flatMap((line) => (line.taxCode ? [line.taxCode] : [])))];
  const rateByCode = await ratesByCode(executor, scope.orgId, codes, documentDate);

  if (rateByCode.size !== codes.length) {
    throw badRequest("TAX_CODE_INVALID", "Choose a GST rate effective on the bill date.");
  }

  const sectionQuery = input.tdsSectionId
    ? executor
        .select({ id: tdsSections.id, rateBasisPoints: tdsSections.rateBasisPoints })
        .from(tdsSections)
        .where(
          and(
            eq(tdsSections.orgId, scope.orgId),
            eq(tdsSections.id, input.tdsSectionId),
            effectiveOn(tdsSections, documentDate),
          ),
        )
        .limit(1)
    : null;

  // Posting holds the section's dates and rate stable until `tds_deductions` commits.
  const [section] = sectionQuery
    ? await (executor === db ? sectionQuery : sectionQuery.for("share"))
    : [];

  if (input.tdsSectionId && !section) {
    throw badRequest("TDS_SECTION_INVALID", "Choose a TDS section effective on this date.");
  }

  if (section && !party.pan) {
    throw badRequest("TDS_PAN_REQUIRED", "Record the party's PAN before deducting TDS.");
  }

  const registered = settings.gstin !== null;
  const intraState = party.stateCode === (input.placeOfSupplyStateCode ?? settings.stateCode);

  const tax = computeTax({
    intraState,
    lines: input.lines.map((line) => ({
      taxablePaise: line.amount,
      rateBasisPoints: line.taxCode ? rateByCode.get(line.taxCode)!.rateBasisPoints : null,
    })),
  });

  const lines: PostDocumentLine[] = input.lines.map((line, index) => ({
    kind: "account",
    accountId: line.accountId,
    description: line.description,
    amountPaise: line.amount,
    discountPaise: 0n,
    entrySide: null,
    partyId: null,
    itemId: null,
    hsnSac: line.hsnSac ?? null,
    unit: null,
    quantity: null,
    unitPricePaise: null,
    taxRateId: line.taxCode ? rateByCode.get(line.taxCode)!.id : null,
    itcEligible: registered && line.itcEligible,
    sourceLineId: null,
    adjustmentKind: null,
    ...tax.lines[index]!,
  }));

  const { taxablePaise, roundOffPaise, totalPaise } = documentTotals(lines);

  if (totalPaise <= 0n)
    throw badRequest("BILL_ZERO_TOTAL", "A bill total must be greater than zero.");
  const tdsPaise = section ? computeTds(taxablePaise, section.rateBasisPoints) : 0n;

  if (tdsPaise >= totalPaise) {
    throw badRequest(
      "BILL_TDS_EXCEEDS_TOTAL",
      "TDS must leave a positive amount payable to the supplier.",
    );
  }

  const posting: BillPosting = {
    type: "bill",
    exposureSide: "payable",
    partyId: party.id,
    amountPaise: totalPaise,
    ...purchaseLegs(lines),
    roundOffPaise,
    tdsPaise,
  };

  return {
    documentDate,
    dueDate: input.dueDate ?? null,
    placeOfSupplyStateCode: input.placeOfSupplyStateCode ?? settings.stateCode,
    intraState,
    reference: input.reference || null,
    narration: input.narration ?? null,
    discountPaise: 0n,
    againstDocumentId: null,
    tdsSectionId: section?.id ?? null,
    affectsTax: registered,
    printSnapshot: {
      organization: organizationSnapshot(settings),
      party: partySnapshot(party),
      lines: lines.map(({ description }) => ({ description })),
    },
    lines,
    posting,
    draft: null,
  };
}

const billInput = orgInput.extend(billFields).extend({ draft: draftToken.optional() }).strict();

const postInput = billInput.refine((input) => !!input.reference?.length, {
  path: ["reference"],
  message: "Supplier invoice reference is required to post a bill.",
});

export const billRouter = {
  saveDraft: orgProcedure({ bill: ["create"] }, billInput).handler(async ({ context, input }) => {
    const settings = await orgSettings(context.scope.orgId);
    const bill = await resolveBill(db, context.scope, input, settings);

    const { draft } = await db.transaction((tx) =>
      writeDraft(
        tx,
        context.scope,
        {
          prefix: settings.billPrefix,
          fiscalYearStartMonth: settings.financialYearStart,
        },
        { ...bill, draft: input.draft ?? null },
      ),
    );

    return draft;
  }),

  post: orgProcedure({ bill: ["post"] }, postInput).handler(async ({ context, input }) => {
    const { posted, amountPaise } = await db.transaction(async (tx) => {
      const settings = await orgSettings(context.scope.orgId, tx);
      const bill = await resolveBill(tx, context.scope, input, settings);

      const posted = await postDocument(tx, context.scope, settings, settings.billPrefix, {
        ...bill,
        draft: input.draft ?? null,
      });

      return { posted, amountPaise: bill.posting.amountPaise };
    });

    audit({
      action: "bill.post",
      actorId: context.scope.userId,
      orgId: context.scope.orgId,
      target: `bill:${posted.id}`,
      meta: { number: posted.number, amount: formatDecimal(amountPaise) },
    });

    return posted;
  }),

  get: orgProcedure({ bill: ["read"] }, orgInput.extend({ billId: z.uuid() })).handler(
    async ({ context, input }) => {
      const { orgId } = context.scope;
      const { capacityPaise, balancePaise } = settlementPaise(orgId, "target");

      const [snapshot, timeZone] = await Promise.all([
        db.transaction(
          async (tx) => {
            const [bill] = await tx
              .select({
                id: documents.id,
                version: documents.version,
                number: documents.number,
                state: documents.state,
                partyId: documents.partyId,
                partyName: printedPartyName,
                documentDate: documents.documentDate,
                dueDate: documents.dueDate,
                placeOfSupplyStateCode: documents.placeOfSupplyStateCode,
                reference: documents.reference,
                narration: documents.narration,
                amendedFromId: documents.amendedFromId,
                cancelledAt: documents.cancelledAt,
                totalPaise: documents.totalPaise,
                discountPaise: documents.discountPaise,
                printSnapshot: documents.printSnapshot,
                roundOffPaise: documents.roundOffPaise,
                capacityPaise,
                outstandingPaise: balancePaise,
              })
              .from(documents)
              .where(
                and(
                  eq(documents.orgId, orgId),
                  eq(documents.id, input.billId),
                  eq(documents.type, "bill"),
                ),
              )
              .limit(1);

            if (!bill) return null;

            const lines = await tx
              .select({
                id: documentLines.id,
                kind: documentLines.kind,
                accountId: documentLines.accountId,
                description: documentLines.description,
                hsnSac: documentLines.hsnSac,
                taxCode: taxRates.code,
                rateBasisPoints: taxRates.rateBasisPoints,
                itcEligible: documentLines.itcEligible,
                cgstPaise: documentLines.cgstPaise,
                sgstPaise: documentLines.sgstPaise,
                igstPaise: documentLines.igstPaise,
                amountPaise: documentLines.amountPaise,
              })
              .from(documentLines)
              .leftJoin(
                taxRates,
                and(eq(taxRates.orgId, orgId), eq(taxRates.id, documentLines.taxRateId)),
              )
              .where(
                and(eq(documentLines.orgId, orgId), eq(documentLines.documentId, input.billId)),
              )
              .orderBy(asc(documentLines.position));

            const allocations = await allocationsOf(tx, orgId, input.billId, "target");

            const [tds] = await tx
              .select({
                tdsSectionId: tdsDeductions.tdsSectionId,
                sectionCode: tdsSections.code,
                basePaise: tdsDeductions.basePaise,
                amountPaise: tdsDeductions.amountPaise,
              })
              .from(tdsDeductions)
              .innerJoin(
                tdsSections,
                and(eq(tdsSections.orgId, orgId), eq(tdsSections.id, tdsDeductions.tdsSectionId)),
              )
              .where(
                and(eq(tdsDeductions.orgId, orgId), eq(tdsDeductions.documentId, input.billId)),
              )
              .limit(1);

            return { bill, lines, allocations, tds: tds ?? null };
          },
          { isolationLevel: "repeatable read", accessMode: "read only" },
        ),
        orgTimeZone(orgId),
      ]);

      if (!snapshot) throw new ORPCError("NOT_FOUND", { message: "Bill not found." });
      const { bill, lines, allocations, tds } = snapshot;

      return {
        ...bill,
        ...documentSettlement(bill, businessDate(new Date(), timeZone)),
        tds,
        lines,
        totals: taxTotals(lines),
        allocations,
      };
    },
  ),

  list: orgProcedure(
    { bill: ["read"] },
    orgInput.extend(claimListFields).superRefine(orderedPeriod),
  ).handler(({ context, input }) => listClaims(context.scope.orgId, "bill", input)),

  cancel: orgProcedure({ bill: ["cancel"] }, orgInput.extend({ billId: z.uuid(), reason })).handler(
    ({ context, input }) => cancelDocument(context.scope, ["bill"], input.billId, input.reason),
  ),

  discardDraft: orgProcedure({ bill: ["create"] }, orgInput.extend({ draft: draftToken })).handler(
    ({ context, input }) => discardDraft(context.scope.orgId, "bill", input.draft),
  ),

  amend: orgProcedure(
    { bill: ["cancel", "create"] },
    orgInput.extend({ billId: z.uuid(), reason }),
  ).handler(({ context, input }) => amendClaim(context.scope, "bill", input.billId, input.reason)),
};
