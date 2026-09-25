import { db, type DbTransaction } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { documentLines } from "@accly/db/schema/document-lines";
import { ADVANCE_SUPPLY_KINDS, documents } from "@accly/db/schema/documents";
import type { organizationSettings } from "@accly/db/schema/organization-settings";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import {
  accountLine,
  organizationSnapshot,
  partySnapshot,
  postDocument,
  receiptSupply,
  receiptTax,
  type PostDocumentInput,
} from "../core/documents";
import { formatDecimal } from "../core/money";
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
  settlementPostFields,
} from "../lib/schemas";
import {
  allocationsOf,
  cancelDocument,
  listSettlements,
  orgSettings,
  settlementDetail,
} from "../lib/settlements";

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
  z.strictObject({
    ...orgInput.shape,
    ...settlementPostFields,
    settlementKind: z.literal("against"),
    partyId: z.uuid(),
    allocations: z
      .array(z.strictObject({ invoiceId: z.uuid(), amount: positiveMoney }))
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
          z.strictObject({ kind: z.literal("tds"), amount: positiveMoney }),
        ]),
      )
      .max(5)
      .optional(),
  }),
  z.strictObject({
    ...orgInput.shape,
    ...settlementPostFields,
    settlementKind: z.literal("direct"),
    partyId: z.uuid().optional(),
    incomeAccountId: z.uuid(),
  }),
]);

type ReceiptInput = z.output<typeof postInput>;

/** Shared transaction path for a normal receipt and an invoice's counter sale. */
export async function postReceipt(
  tx: DbTransaction,
  scope: Scope,
  settings: typeof organizationSettings.$inferSelect,
  input: ReceiptInput,
) {
  const { settlementKind } = input;

  const allocatedPaise =
    settlementKind === "against"
      ? input.allocations.reduce((sum, allocation) => sum + allocation.amount, 0n)
      : 0n;

  const adjustments = settlementKind === "against" ? (input.adjustments ?? []) : [];
  const adjustmentPaise = adjustments.reduce((sum, adjustment) => sum + adjustment.amount, 0n);

  const remainderSupply =
    settlementKind === "against" && allocatedPaise < input.amount + adjustmentPaise
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
      ? await postableAccounts(tx, scope.orgId, [input.incomeAccountId], ["income"]).for("share", {
          of: accounts,
        })
      : [];

  const adjustmentIds = [
    ...new Set(
      adjustments.flatMap((adjustment) =>
        adjustment.kind === "tds" ? [] : [adjustment.accountId],
      ),
    ),
  ];

  const adjustmentAccounts =
    adjustmentIds.length > 0
      ? await postableAccounts(tx, scope.orgId, adjustmentIds, ["expense"]).for("share", {
          of: accounts,
        })
      : [];

  if (adjustmentAccounts.length !== adjustmentIds.length) {
    throw badRequest("ADJUSTMENT_ACCOUNT_INVALID", "Choose an active non-system expense leaf.");
  }

  if (input.partyId && !party) {
    throw badRequest("PARTY_INVALID", "Choose a party in this organization.");
  }

  const documentDate = input.documentDate ?? businessDate(new Date(), settings.timeZone);
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
      adjustments: adjustments.map(({ amount, ...adjustment }) => ({
        ...adjustment,
        amountPaise: amount,
      })),
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
          ? "Customer TDS"
          : adjustment.kind === "fee"
            ? "Fee"
            : "Write-off",
        adjustment.amount,
      ),
      adjustmentKind: adjustment.kind,
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
  post: orgProcedure({ receipt: ["post"] }, postInput).handler(async ({ context, input }) => {
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

      const [detail, allocations, adjustments] = await Promise.all([
        settlementDetail(orgId, "receipt", input.receiptId),
        allocationsOf(db, orgId, input.receiptId, "source"),
        db
          .select({
            adjustmentKind: documentLines.adjustmentKind,
            accountId: documentLines.accountId,
            amountPaise: documentLines.amountPaise,
          })
          .from(documentLines)
          .where(
            and(
              eq(documentLines.orgId, orgId),
              eq(documentLines.documentId, input.receiptId),
              isNotNull(documentLines.adjustmentKind),
            ),
          )
          .orderBy(asc(documentLines.position)),
      ]);

      return { ...detail, adjustments, allocations };
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

  cancel: orgProcedure(
    { receipt: ["cancel"] },
    orgInput.extend({ receiptId: z.uuid(), reason }),
  ).handler(({ context, input }) =>
    cancelDocument(context.scope, ["receipt"], input.receiptId, input.reason),
  ),
};
