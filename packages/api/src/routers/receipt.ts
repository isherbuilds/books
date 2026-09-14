import { db } from "@accly/db";
import { ADVANCE_SUPPLY_KINDS, documents } from "@accly/db/schema/documents";
import { organizationSettings } from "@accly/db/schema/organization-settings";
import { parties } from "@accly/db/schema/parties";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import {
  organizationSnapshot,
  partySnapshot,
  postDocument,
  receiptTax,
  type PostDocumentInput,
} from "../core/documents";
import { formatDecimal } from "../core/money";
import { postableAccount } from "../lib/accounts";
import { businessDate } from "../lib/business-date";
import { badRequest, impossible } from "../lib/conflict";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { orderedPeriod, reason, settlementListFields, settlementPostFields } from "../lib/schemas";
import { cancelSettlement, listSettlements, settlementDetail } from "../lib/settlements";

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

    // Independent lookups; validation order below still reports the first missing input.
    // postDocument checks the Payment Method under a lock inside the transaction.
    const [party, incomeAccount, storedSettings] = await Promise.all([
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
      db
        .select()
        .from(organizationSettings)
        .where(eq(organizationSettings.orgId, scope.orgId))
        .limit(1)
        .then(([row]) => row),
    ]);

    if (!storedSettings) {
      throw new Error(`Organization ${scope.orgId} is missing its settings`);
    }

    if (input.partyId && !party) {
      throw badRequest("PARTY_INVALID", "Choose a party in this organization.");
    }

    const documentDate = input.documentDate ?? businessDate(new Date(), storedSettings.timeZone);
    let lineDescription: string;
    let affectsTax: boolean;
    let posting: PostDocumentInput["posting"];

    if (settlementKind === "advance") {
      lineDescription = input.narration ?? "Advance received";
      affectsTax = false;
      posting = {
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
    } else {
      if (!incomeAccount) {
        throw badRequest(
          "INCOME_ACCOUNT_INVALID",
          "Choose an active income account that is not a group or system account.",
        );
      }

      const tax = receiptTax(storedSettings.gstin, incomeAccount.supplyClass);

      if (tax.refused) {
        throw badRequest(
          "TAXABLE_DIRECT_RECEIPT",
          "Taxable income must be invoiced before it is received.",
        );
      }

      lineDescription = input.narration ?? incomeAccount.name;
      affectsTax = tax.affectsTax;
      posting = {
        type: "receipt",
        settlementKind,
        exposureSide: null,
        partyId: party?.id ?? null,
        accountId: incomeAccount.id,
        amountPaise: input.amount,
      };
    }

    const printSnapshot = {
      organization: organizationSnapshot(storedSettings),
      party: partySnapshot(party),
      lines: [{ description: lineDescription, hsnSac: null, unit: null }],
    };

    const posted = await db.transaction((tx) =>
      postDocument(
        tx,
        scope,
        {
          prefix: storedSettings.receiptPrefix,
          fiscalYearStartMonth: storedSettings.financialYearStart,
        },
        {
          documentDate,
          paymentMethodId: input.paymentMethodId,
          reference: input.reference ?? null,
          narration: input.narration ?? null,
          affectsTax,
          printSnapshot,
          lineDescription,
          posting,
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
        advanceSupply: settlementKind === "advance" ? input.advanceSupply : null,
      },
    });

    // The receipt form reads only these; the detail is one receipt.get away.
    return posted;
  }),

  get: orgProcedure({ receipt: ["read"] }, orgInput.extend({ receiptId: z.uuid() })).handler(
    ({ context, input }) => settlementDetail(context.scope.orgId, "receipt", input.receiptId),
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
    cancelSettlement(context.scope, "receipt", input.receiptId, input.reason),
  ),
};
