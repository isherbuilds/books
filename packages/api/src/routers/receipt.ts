import { db, type DbTransaction } from "@accly/db";
import { authorize, REFUND_GRANT } from "@accly/auth/access";
import { ADVANCE_SUPPLY_KINDS, documents } from "@accly/db/schema/documents";
import { paymentMethods } from "@accly/db/schema/payment-methods";
import type { organizationSettings } from "@accly/db/schema/organization-settings";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { audit } from "@accly/db/audit";
import {
  accountLine,
  organizationSnapshot,
  partySnapshot,
  postDocument,
  receiptSupply,
  receiptTax,
  type PostDocumentInput,
} from "../core/documents";
import { settlementPaise } from "../core/allocations";
import { documentRole } from "../core/document-roles";
import { effectiveTdsSections } from "../core/tax-schedule";
import { formatDecimal, sumPaise } from "../core/money";
import { postableAccounts } from "../lib/accounts";
import { businessDate } from "../lib/business-date";
import { badRequest, impossible } from "../lib/conflict";
import { activeParty } from "../lib/parties";
import { orgInput, orgProcedure, type Scope } from "../lib/procedures/factory";
import {
  orderedPeriod,
  positiveMoney,
  reason,
  settlementListFields,
  settlementFilterFields,
  settlementPostFields,
} from "../lib/schemas";
import {
  adjustmentLinesOf,
  allocationsOf,
  assertRefundAmount,
  cancelDocument,
  settlementListRow,
  registerPage,
  settlementTotals,
  settlementListWhere,
  settlementDetail,
} from "../lib/settlements";
import { orgSettings } from "../lib/org-settings";
import { paiseSum } from "../lib/sql";

// The receipt PDF prints only the document row.
export type ReceiptDetail = typeof documents.$inferSelect;

const postInput = z.discriminatedUnion("settlementKind", [
  z.strictObject({
    ...orgInput.shape,
    ...settlementPostFields,
    settlementKind: z.literal("advance"),
    partyId: z.uuid(),
    advanceSupply: z.enum(ADVANCE_SUPPLY_KINDS),
  }),
  z.discriminatedUnion("exposureSide", [
    z.strictObject({
      ...orgInput.shape,
      ...settlementPostFields,
      settlementKind: z.literal("against"),
      exposureSide: z.literal("receivable"),
      partyId: z.uuid(),
      allocations: z
        .array(z.strictObject({ documentId: z.uuid(), amount: positiveMoney }))
        .min(1)
        .max(50),
      advanceSupply: z.enum(ADVANCE_SUPPLY_KINDS).optional(),
      adjustments: z
        .array(
          z.discriminatedUnion("kind", [
            z.strictObject({ kind: z.literal("fee"), accountId: z.uuid(), amount: positiveMoney }),
            z.strictObject({
              kind: z.literal("writeOff"),
              accountId: z.uuid(),
              amount: positiveMoney,
            }),
            z.strictObject({
              kind: z.literal("tds"),
              amount: positiveMoney,
              tdsSectionId: z.uuid(),
            }),
          ]),
        )
        .max(5)
        .optional(),
    }),
    z.strictObject({
      ...orgInput.shape,
      ...settlementPostFields,
      settlementKind: z.literal("against"),
      exposureSide: z.literal("payable"),
      partyId: z.uuid(),
      allocations: z
        .array(z.strictObject({ documentId: z.uuid(), amount: positiveMoney }))
        .min(1)
        .max(50),
    }),
  ]),
  z.strictObject({
    ...orgInput.shape,
    ...settlementPostFields,
    settlementKind: z.literal("direct"),
    partyId: z.uuid().optional(),
    incomeAccountId: z.uuid(),
  }),
]);

type ReceiptInput = z.output<typeof postInput>;

/** A supplier refund: a Receipt that pays out the supplier's credits. */
const isRefund = (input: ReceiptInput) =>
  input.settlementKind === "against" &&
  documentRole({ type: "receipt", exposureSide: input.exposureSide }).refund === true;

/** Shared transaction path for a normal receipt and an invoice's counter sale. */
export async function postReceipt(
  tx: DbTransaction,
  scope: Scope,
  settings: typeof organizationSettings.$inferSelect,
  input: ReceiptInput,
) {
  const { settlementKind } = input;
  const refund = isRefund(input);
  // The input's own discriminant narrows it to the fields a customer receipt carries.
  const isCustomerAgainst = settlementKind === "against" && input.exposureSide === "receivable";

  const allocatedPaise =
    settlementKind === "against"
      ? sumPaise(input.allocations.map((allocation) => allocation.amount))
      : 0n;

  if (refund) assertRefundAmount(input.amount, allocatedPaise);

  const adjustments = isCustomerAgainst ? (input.adjustments ?? []) : [];

  const adjustmentPaise = sumPaise(adjustments.map((adjustment) => adjustment.amount));

  const remainderSupply =
    isCustomerAgainst && allocatedPaise < input.amount + adjustmentPaise
      ? input.advanceSupply
      : null;

  if (remainderSupply === undefined && adjustments.length === 0) {
    throw badRequest(
      "ADVANCE_SUPPLY_REQUIRED",
      "Choose what the remaining advance is received for.",
    );
  }

  const advanceSupply = remainderSupply ?? null;
  const party = input.partyId ? await activeParty(tx, scope.orgId, input.partyId) : null;

  const [incomeAccount] =
    settlementKind === "direct"
      ? await postableAccounts(tx, scope.orgId, [input.incomeAccountId], ["income"])
      : [];

  const adjustmentIds = [
    ...new Set(
      adjustments.flatMap((adjustment) =>
        adjustment.kind === "tds" ? [] : [adjustment.accountId],
      ),
    ),
  ];

  const adjustmentAccounts = await postableAccounts(tx, scope.orgId, adjustmentIds, ["expense"]);

  if (adjustmentAccounts.length !== adjustmentIds.length) {
    throw badRequest("ADJUSTMENT_ACCOUNT_INVALID", "Choose an active non-system expense leaf.");
  }

  if (input.partyId && !party) {
    throw badRequest("PARTY_INVALID", "Choose a party in this organization.");
  }

  const documentDate = input.documentDate ?? businessDate(new Date(), settings.timeZone);

  const sectionIds = [
    ...new Set(
      adjustments.flatMap((adjustment) =>
        adjustment.kind === "tds" ? [adjustment.tdsSectionId] : [],
      ),
    ),
  ];

  await effectiveTdsSections(tx, scope.orgId, sectionIds, documentDate);

  let lineDescription: string;
  let affectsTax: boolean;
  let posting: PostDocumentInput["posting"];
  // Only a direct receipt is a supply, so only it has a place of supply.
  let supply: ReturnType<typeof receiptSupply> | null = null;

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
      partyId: input.partyId,
      accountId: null,
      amountPaise: input.amount,
    };
  } else if (settlementKind === "against") {
    affectsTax = false;
    lineDescription = refund
      ? (input.narration ?? "Supplier refund")
      : "Receipt against open items";

    const allocations = input.allocations.map(({ documentId, amount }) => ({
      documentId,
      amountPaise: amount,
    }));

    posting = refund
      ? {
          paymentMethodId: input.paymentMethodId,
          type: "receipt",
          settlementKind,
          exposureSide: "payable",
          partyId: input.partyId,
          accountId: null,
          amountPaise: input.amount,
          sources: allocations,
        }
      : {
          paymentMethodId: input.paymentMethodId,
          type: "receipt",
          settlementKind,
          exposureSide: "receivable",
          partyId: input.partyId,
          accountId: null,
          amountPaise: input.amount,
          allocations,
          adjustments: adjustments.map((adjustment) =>
            adjustment.kind === "tds"
              ? { kind: "tds" as const, amountPaise: adjustment.amount }
              : {
                  kind: adjustment.kind,
                  accountId: adjustment.accountId,
                  amountPaise: adjustment.amount,
                },
          ),
          advanceSupply,
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
    supply = receiptSupply(party?.stateCode ?? null, settings.stateCode);
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

  const lines = [
    accountLine(posting.accountId, lineDescription, posting.amountPaise),
    ...adjustments.map((adjustment) => ({
      ...accountLine(
        adjustment.kind === "tds" ? null : adjustment.accountId,
        adjustment.kind === "tds"
          ? "TDS deducted by customer"
          : adjustment.kind === "fee"
            ? "Fee"
            : "Write-off",
        adjustment.amount,
      ),
      adjustmentKind: adjustment.kind,
      tdsSectionId: adjustment.kind === "tds" ? adjustment.tdsSectionId : null,
    })),
  ];

  const posted = await postDocument(tx, scope, settings, settings.receiptPrefix, {
    documentDate,
    dueDate: null,
    placeOfSupplyStateCode: supply?.placeOfSupplyStateCode ?? null,
    intraState: supply?.intraState,
    reference: input.reference ?? null,
    narration: input.narration ?? null,
    discountPaise: 0n,
    againstDocumentId: null,
    affectsTax,
    printSnapshot,
    lines,
    posting,
    draft: null,
  });

  return { posted, allocatedPaise, advanceSupply };
}

export function auditReceiptPost(
  scope: Scope,
  posted: { id: string; number: string },
  input: ReceiptInput,
  allocatedPaise: bigint,
  advanceSupply: (typeof ADVANCE_SUPPLY_KINDS)[number] | null,
) {
  audit({
    action: "receipt.post",
    actorId: scope.userId,
    orgId: scope.orgId,
    target: `receipt:${posted.id}`,
    meta: {
      number: posted.number,
      amount: formatDecimal(input.amount),
      settlementKind: input.settlementKind,
      advanceSupply: input.settlementKind === "advance" ? input.advanceSupply : advanceSupply,
      allocatedAmount: input.settlementKind === "against" ? formatDecimal(allocatedPaise) : null,
    },
  });
}

export const receiptRouter = {
  post: orgProcedure(
    (input) => (isRefund(input) ? { receipt: ["post"], ...REFUND_GRANT } : { receipt: ["post"] }),
    postInput,
  ).handler(async ({ context, input }) => {
    const result = await db.transaction(async (tx) => {
      const settings = await orgSettings(context.scope.orgId, tx);

      return postReceipt(tx, context.scope, settings, input);
    });

    auditReceiptPost(
      context.scope,
      result.posted,
      input,
      result.allocatedPaise,
      result.advanceSupply,
    );

    return result.posted;
  }),

  get: orgProcedure({ receipt: ["read"] }, orgInput.extend({ receiptId: z.uuid() })).handler(
    async ({ context, input }) => {
      const { orgId } = context.scope;

      const detail = await settlementDetail(orgId, "receipt", input.receiptId);
      const { refund } = documentRole(detail);
      const canReadRelated = !refund || authorize(context.scope.roles, REFUND_GRANT);

      const [allocations, adjustments, [credit]] = await Promise.all([
        canReadRelated
          ? allocationsOf(
              db,
              orgId,
              input.receiptId,
              refund ? "target" : "source",
              refund || authorize(context.scope.roles, { journal: ["read"] })
                ? undefined
                : ["invoice", "payment"],
            )
          : Promise.resolve([]),
        adjustmentLinesOf(orgId, input.receiptId),
        !refund
          ? db
              .select({ unappliedPaise: settlementPaise(orgId, "source", null).balancePaise })
              .from(documents)
              .where(and(eq(documents.orgId, orgId), eq(documents.id, input.receiptId)))
          : Promise.resolve([]),
      ]);

      let unappliedPaise: bigint | null = null;

      if (detail.settlementKind !== "direct" && !refund) {
        if (!credit) throw impossible(`receipt ${detail.id} has no settlement balance`);
        // A cancelled receipt keeps its capacity row but settles nothing.
        unappliedPaise = detail.state === "posted" ? credit.unappliedPaise : 0n;
      }

      // Received plus adjustments less what still waits as an advance: the balance also
      // counts allocations this reader may not list (an operator's Journals). A refund or
      // a cancelled receipt applies what its listed allocations still hold.
      const appliedPaise =
        detail.state === "posted" && unappliedPaise !== null
          ? detail.totalPaise + sumPaise(adjustments.map((row) => row.amountPaise)) - unappliedPaise
          : sumPaise(allocations.flatMap((row) => (row.reversed ? [] : [row.amountPaise])));

      return {
        ...detail,
        adjustments,
        allocations,
        unappliedPaise,
        appliedPaise,
      };
    },
  ),

  list: orgProcedure(
    { receipt: ["read"] },
    orgInput.extend(settlementListFields).superRefine(orderedPeriod),
  ).handler(async ({ context, input }) => {
    const { orgId } = context.scope;

    return registerPage(orgId, ["receipt"], input, (listed) =>
      db
        .select({ ...settlementListRow, paymentMethodName: paymentMethods.name })
        .from(documents)
        .innerJoin(
          paymentMethods,
          and(eq(paymentMethods.orgId, orgId), eq(paymentMethods.id, documents.paymentMethodId)),
        )
        .where(and(listed, settlementListWhere(input)))
        .orderBy(desc(documents.documentDate), desc(documents.id))
        .limit(input.limit + 1),
    );
  }),

  totals: orgProcedure(
    { receipt: ["read"] },
    orgInput.extend(settlementFilterFields).superRefine(orderedPeriod),
  ).handler(({ context, input }) => settlementTotals(context.scope.orgId, "receipt", input)),

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
        receivedPaise: paiseSum(documents.totalPaise),
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

  cancel: orgProcedure(
    { receipt: ["cancel"] },
    orgInput.extend({ receiptId: z.uuid(), reason }),
  ).handler(({ context, input }) =>
    cancelDocument(context.scope, ["receipt"], input.receiptId, input.reason),
  ),
};
