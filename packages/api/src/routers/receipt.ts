import { db } from "@accly/db";
import { allocations } from "@accly/db/schema/allocations";
import { ADVANCE_SUPPLY_KINDS, documents } from "@accly/db/schema/documents";
import { parties } from "@accly/db/schema/parties";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { allocationReversed, remainingPaiseOf } from "../core/allocations";
import {
  accountLine,
  organizationSnapshot,
  partySnapshot,
  postDocument,
  postedNumber,
  receiptTax,
  type PostDocumentInput,
} from "../core/documents";
import { formatDecimal } from "../core/money";
import { postableAccount } from "../lib/accounts";
import { businessDate } from "../lib/business-date";
import { badRequest, impossible } from "../lib/conflict";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import {
  orderedPeriod,
  positiveMoney,
  reason,
  settlementListFields,
  settlementPostFields,
} from "../lib/schemas";
import {
  PICKER_LIMIT,
  cancelDocument,
  listSettlements,
  orgSettings,
  pageOf,
  settlementDetail,
} from "../lib/settlements";

// The receipt PDF prints only the document row.
export type ReceiptDetail = typeof documents.$inferSelect;

const postInput = z.discriminatedUnion("settlementKind", [
  orgInput
    .extend(settlementPostFields)
    .extend({
      settlementKind: z.literal("advance"),
      partyId: z.uuid(),
      advanceSupply: z.enum(ADVANCE_SUPPLY_KINDS),
    })
    .strict(),
  orgInput
    .extend(settlementPostFields)
    .extend({
      settlementKind: z.literal("against"),
      partyId: z.uuid(),
      allocations: z
        .array(z.object({ invoiceId: z.uuid(), amount: positiveMoney }).strict())
        .min(1)
        .max(50),
      advanceSupply: z.enum(ADVANCE_SUPPLY_KINDS).optional(),
    })
    .strict(),
  orgInput
    .extend(settlementPostFields)
    .extend({
      settlementKind: z.literal("direct"),
      partyId: z.uuid().optional(),
      incomeAccountId: z.uuid(),
    })
    .strict(),
]);

export const receiptRouter = {
  post: orgProcedure({ receipt: ["post"] }, postInput).handler(async ({ context, input }) => {
    const { scope } = context;
    const { settlementKind } = input;

    const allocatedPaise =
      settlementKind === "against"
        ? input.allocations.reduce((sum, allocation) => sum + allocation.amount, 0n)
        : 0n;

    // Only an unallocated remainder is held as an advance, so only it records a supply.
    const remainderSupply =
      settlementKind === "against" && allocatedPaise < input.amount ? input.advanceSupply : null;

    if (remainderSupply === undefined) {
      throw badRequest(
        "ADVANCE_SUPPLY_REQUIRED",
        "Choose what the remaining advance is received for.",
      );
    }

    // Independent lookups; validation order below still reports the first missing input.
    // postDocument checks the Payment Method under a lock inside the transaction.
    const [party, incomeAccount, settings] = await Promise.all([
      input.partyId
        ? db
            .select()
            .from(parties)
            .where(and(eq(parties.orgId, scope.orgId), eq(parties.id, input.partyId)))
            .limit(1)
            .then(([row]) => row)
        : undefined,
      settlementKind === "direct"
        ? postableAccount(scope.orgId, input.incomeAccountId, ["income"])
        : undefined,
      orgSettings(scope.orgId),
    ]);

    if (input.partyId && !party) {
      throw badRequest("PARTY_INVALID", "Choose a party in this organization.");
    }

    const documentDate = input.documentDate ?? businessDate(new Date(), settings.timeZone);
    let lineDescription: string;
    let affectsTax: boolean;
    let posting: PostDocumentInput["posting"];

    if (settlementKind === "advance") {
      lineDescription = input.narration ?? "Advance received";
      affectsTax = false;
      posting = {
        paymentMethodId: input.paymentMethodId,
        type: "receipt",
        settlementKind,
        advanceSupply: input.advanceSupply,
        // A receipt's advance is always money the party paid ahead of its bills.
        exposureSide: "receivable",
        // The batch above proved this id resolves to a party in this organization.
        partyId: input.partyId,
        accountId: null,
        amountPaise: input.amount,
      };
    } else if (settlementKind === "against") {
      lineDescription = "Receipt against invoices";
      affectsTax = false;
      posting = {
        paymentMethodId: input.paymentMethodId,
        type: "receipt",
        settlementKind,
        exposureSide: "receivable",
        partyId: input.partyId,
        accountId: null,
        amountPaise: input.amount,
        allocations: input.allocations.map((allocation) => ({
          documentId: allocation.invoiceId,
          amountPaise: allocation.amount,
        })),
        advanceSupply: remainderSupply,
      };
    } else {
      if (!incomeAccount) {
        throw badRequest(
          "INCOME_ACCOUNT_INVALID",
          "Choose an active income account that is not a group or system account.",
        );
      }

      const tax = receiptTax(settings.gstin, incomeAccount.supplyClass);

      if (tax.refused) {
        throw badRequest(
          "TAXABLE_DIRECT_RECEIPT",
          "Taxable income must be invoiced before it is received.",
        );
      }

      lineDescription = input.narration ?? incomeAccount.name;
      affectsTax = tax.affectsTax;
      posting = {
        paymentMethodId: input.paymentMethodId,
        type: "receipt",
        settlementKind,
        exposureSide: null,
        partyId: party?.id ?? null,
        accountId: incomeAccount.id,
        amountPaise: input.amount,
      };
    }

    const printSnapshot = {
      organization: organizationSnapshot(settings),
      party: partySnapshot(party),
      lines: [{ description: lineDescription }],
    };

    const posted = await db.transaction((tx) =>
      postDocument(
        tx,
        scope,
        {
          prefix: settings.receiptPrefix,
          fiscalYearStartMonth: settings.financialYearStart,
        },
        {
          documentDate,
          dueDate: null,
          placeOfSupplyStateCode: null,
          reference: input.reference ?? null,
          narration: input.narration ?? null,
          affectsTax,
          printSnapshot,
          lines: [accountLine(posting.accountId, lineDescription, posting.amountPaise)],
          posting,
          draft: null,
        },
      ),
    );

    audit({
      action: "receipt.post",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: posted.id,
      meta: {
        number: posted.number,
        amount: formatDecimal(input.amount),
        settlementKind,
        advanceSupply: settlementKind === "advance" ? input.advanceSupply : remainderSupply,
        allocatedAmount: settlementKind === "against" ? formatDecimal(allocatedPaise) : null,
      },
    });

    // The receipt form reads only these; the detail is one receipt.get away.
    return posted;
  }),

  get: orgProcedure({ receipt: ["read"] }, orgInput.extend({ receiptId: z.uuid() })).handler(
    async ({ context, input }) => {
      const { orgId } = context.scope;

      const [detail, rows] = await Promise.all([
        settlementDetail(orgId, "receipt", input.receiptId),
        db
          .select({
            id: allocations.id,
            targetDocumentId: allocations.targetDocumentId,
            targetNumber: documents.number,
            amountPaise: allocations.amountPaise,
            entryDate: allocations.entryDate,
            reversed: allocationReversed(orgId),
          })
          .from(allocations)
          .innerJoin(
            documents,
            and(eq(documents.orgId, orgId), eq(documents.id, allocations.targetDocumentId)),
          )
          .where(
            and(
              eq(allocations.orgId, orgId),
              eq(allocations.sourceDocumentId, input.receiptId),
              eq(allocations.kind, "apply"),
            ),
          )
          .orderBy(asc(allocations.entryDate), asc(allocations.id)),
      ]);

      return {
        ...detail,
        allocations: rows.map((row) => ({
          ...row,
          targetNumber: postedNumber(row.targetNumber, row.targetDocumentId),
        })),
      };
    },
  ),

  list: orgProcedure(
    { receipt: ["read"] },
    orgInput.extend(settlementListFields).superRefine(orderedPeriod),
  ).handler(({ context, input }) => listSettlements(context.scope.orgId, "receipt", input)),

  // Received per party. A grouped read of its own, not a column on the cached party
  // master, so posting a receipt never refetches up to 5,000 parties. `partyId`
  // narrows it to the one row a party page shows.
  partyTotals: orgProcedure(
    { receipt: ["read"] },
    orgInput.extend({ partyId: z.uuid().optional() }),
  ).handler(async ({ context, input }) => {
    const rows = await db
      .select({
        partyId: documents.partyId,
        receivedPaise: sql<bigint>`sum(${documents.totalPaise})::bigint`.mapWith(BigInt),
      })
      .from(documents)
      .where(
        and(
          eq(documents.orgId, context.scope.orgId),
          eq(documents.type, "receipt"),
          eq(documents.state, "posted"),
          input.partyId ? eq(documents.partyId, input.partyId) : isNotNull(documents.partyId),
        ),
      )
      .groupBy(documents.partyId);

    return rows.map(({ partyId, receivedPaise }) => {
      if (partyId === null) throw impossible("a receipt totals group without a party");

      return { partyId, receivedPaise };
    });
  }),

  unapplied: orgProcedure({ receipt: ["read"] }, orgInput.extend({ partyId: z.uuid() })).handler(
    async ({ context, input }) => {
      const { orgId } = context.scope;
      const unappliedPaise = remainingPaiseOf(orgId, "source");

      const rows = await db
        .select({
          id: documents.id,
          number: documents.number,
          documentDate: documents.documentDate,
          unappliedPaise,
        })
        .from(documents)
        .where(
          and(
            eq(documents.orgId, orgId),
            eq(documents.type, "receipt"),
            eq(documents.state, "posted"),
            eq(documents.partyId, input.partyId),
            inArray(documents.settlementKind, ["advance", "against"]),
            sql`${unappliedPaise} > 0`,
          ),
        )
        .orderBy(asc(documents.documentDate), asc(documents.id))
        .limit(PICKER_LIMIT + 1);

      return pageOf(
        rows.map((row) => ({ ...row, number: postedNumber(row.number, row.id) })),
        PICKER_LIMIT,
      );
    },
  ),

  cancel: orgProcedure(
    { receipt: ["cancel"] },
    orgInput.extend({ receiptId: z.uuid(), reason }),
  ).handler(({ context, input }) =>
    cancelDocument(context.scope, "receipt", input.receiptId, input.reason),
  ),
};
