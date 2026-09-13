import { db } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { documentLines } from "@accly/db/schema/document-lines";
import {
  ADVANCE_SUPPLY_KINDS,
  documents,
  SETTLEMENT_KINDS,
  type PrintSnapshot,
} from "@accly/db/schema/documents";
import { organizationSettings } from "@accly/db/schema/organization-settings";
import { parties } from "@accly/db/schema/parties";
import { paymentMethods } from "@accly/db/schema/payment-methods";
import { ORPCError } from "@orpc/server";
import {
  and,
  count,
  desc,
  eq,
  getTableColumns,
  gte,
  ilike,
  inArray,
  isNotNull,
  lt,
  lte,
  max,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { impossible } from "../lib/conflict";
import {
  DocumentAlreadyCancelledError,
  DocumentNotFoundError,
  postDocument,
  reverseDocument,
} from "../core/documents";
import { formatDecimal } from "../core/money";
import type { ReceiptPosting } from "../core/posting";
import { businessDate } from "../lib/business-date";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import {
  dateOnly,
  likePattern,
  orderedPeriod,
  period,
  positiveMoney,
  reason,
  searchQuery,
} from "../lib/schemas";
import { readOrgSettings } from "../lib/settings-cache";

export type ReceiptDetail = typeof documents.$inferSelect & {
  paymentMethodName: string;
  lines: Array<typeof documentLines.$inferSelect>;
};

function badRequest(reason: string, message: string) {
  return new ORPCError("BAD_REQUEST", { message, data: { reason } });
}

function addressLine(
  addressLine1: string | null,
  addressLine2: string | null,
  city: string | null,
  pinCode: string | null,
): string {
  const locality = [city, pinCode].filter(Boolean).join(" ");

  return [addressLine1, addressLine2, locality].filter(Boolean).join(", ");
}

async function getReceiptDetail(orgId: string, receiptId: string): Promise<ReceiptDetail> {
  const [receipt] = await db
    .select({ ...getTableColumns(documents), paymentMethodName: paymentMethods.name })
    .from(documents)
    .innerJoin(
      paymentMethods,
      and(eq(paymentMethods.orgId, orgId), eq(paymentMethods.id, documents.paymentMethodId)),
    )
    .where(
      and(eq(documents.orgId, orgId), eq(documents.id, receiptId), eq(documents.type, "receipt")),
    )
    .limit(1);

  if (!receipt) throw new ORPCError("NOT_FOUND", { message: "Receipt not found." });

  const lines = await db
    .select()
    .from(documentLines)
    .where(and(eq(documentLines.orgId, orgId), eq(documentLines.documentId, receiptId)))
    .orderBy(documentLines.position, documentLines.id);

  return { ...receipt, lines };
}

const postFields = {
  documentDate: dateOnly.optional(),
  amount: positiveMoney,
  paymentMethodId: z.string().uuid(),
  reference: z.string().trim().max(120).optional(),
  narration: z
    .string()
    .trim()
    .max(500)
    .transform((value) => value || undefined)
    .optional(),
};

const postInput = z.discriminatedUnion("settlementKind", [
  orgInput
    .extend(postFields)
    .extend({
      settlementKind: z.literal("advance"),
      partyId: z.string().uuid(),
      advanceSupply: z.enum(ADVANCE_SUPPLY_KINDS),
    })
    .strict(),
  orgInput
    .extend(postFields)
    .extend({
      settlementKind: z.literal("direct"),
      partyId: z.string().uuid().optional(),
      incomeAccountId: z.string().uuid(),
    })
    .strict(),
]);

export const receiptRouter = {
  post: orgProcedure({ receipt: ["post"] }, postInput).handler(async ({ context, input }) => {
    const { scope } = context;
    const { settlementKind } = input;

    // Independent lookups; validation order below still reports the first missing input.
    const [[paymentMethod], party, incomeAccount, storedSettings] = await Promise.all([
      db
        .select()
        .from(paymentMethods)
        .where(
          and(
            eq(paymentMethods.orgId, scope.orgId),
            eq(paymentMethods.id, input.paymentMethodId),
            eq(paymentMethods.active, true),
          ),
        )
        .limit(1),
      input.partyId
        ? db
            .select()
            .from(parties)
            .where(and(eq(parties.orgId, scope.orgId), eq(parties.id, input.partyId)))
            .limit(1)
            .then(([row]) => row)
        : undefined,
      settlementKind === "direct"
        ? db
            .select()
            .from(accounts)
            .where(
              and(
                eq(accounts.orgId, scope.orgId),
                eq(accounts.id, input.incomeAccountId),
                eq(accounts.active, true),
                eq(accounts.type, "income"),
              ),
            )
            .limit(1)
            .then(([row]) => row)
        : undefined,
      db
        .select()
        .from(organizationSettings)
        .where(eq(organizationSettings.orgId, scope.orgId))
        .limit(1)
        .then(([row]) => row),
    ]);

    if (!paymentMethod) {
      throw badRequest("PAYMENT_METHOD_INVALID", "Choose an active payment method.");
    }

    if (!storedSettings) {
      throw new Error(`Organization ${scope.orgId} is missing its settings`);
    }

    const documentDate = input.documentDate ?? businessDate(new Date(), storedSettings.timeZone);
    let lineDescription: string;
    let affectsTax: boolean;
    let posting: ReceiptPosting;

    if (settlementKind === "advance") {
      if (!party) {
        throw badRequest("PARTY_INVALID", "Choose a party in this organization.");
      }

      if (input.advanceSupply === "taxableService") {
        throw badRequest(
          "ADVANCE_TAX_UNSUPPORTED",
          "A taxable service advance needs GST advance documents, which are not available yet.",
        );
      }

      lineDescription = input.narration ?? "Advance received";
      affectsTax = false;
      posting = {
        settlementKind,
        advanceSupply: input.advanceSupply,
        // A receipt's advance is always money the party paid ahead of its bills.
        exposureSide: "receivable",
        partyId: party.id,
        incomeAccountId: null,
        amountPaise: input.amount,
      };
    } else {
      if (input.partyId && !party) {
        throw badRequest("PARTY_INVALID", "Choose a party in this organization.");
      }

      if (!incomeAccount) {
        throw badRequest("INCOME_ACCOUNT_INVALID", "Choose an active income account.");
      }

      if (storedSettings.gstin && incomeAccount.supplyClass === "taxable") {
        throw badRequest(
          "TAXABLE_DIRECT_RECEIPT",
          "Taxable income must be invoiced before it is received.",
        );
      }

      lineDescription = input.narration ?? incomeAccount.name;
      affectsTax =
        Boolean(storedSettings.gstin) &&
        ["exempt", "nil", "nonGst"].includes(incomeAccount.supplyClass ?? "");
      posting = {
        settlementKind,
        exposureSide: null,
        partyId: party?.id ?? null,
        incomeAccountId: incomeAccount.id,
        amountPaise: input.amount,
      };
    }

    const printSnapshot: PrintSnapshot = {
      organization: {
        legalName: storedSettings.legalName,
        address: addressLine(
          storedSettings.addressLine1,
          storedSettings.addressLine2,
          storedSettings.city,
          storedSettings.pinCode,
        ),
        gstin: storedSettings.gstin,
        pan: storedSettings.pan,
      },
      party: party
        ? {
            name: party.name,
            address: addressLine(party.addressLine1, party.addressLine2, party.city, party.pinCode),
            gstin: party.gstin,
          }
        : null,
      paymentMethod: paymentMethod.name,
      lines: [{ description: lineDescription, hsnSac: null, unit: null }],
    };

    const posted = await db.transaction((tx) =>
      postDocument(
        tx,
        scope,
        {
          fiscalYearStartMonth: storedSettings.financialYearStart,
          receiptPrefix: storedSettings.receiptPrefix,
          timeZone: storedSettings.timeZone,
        },
        {
          documentDate,
          paymentMethodId: paymentMethod.id,
          paymentMethodAccountId: paymentMethod.accountId,
          reference: input.reference || null,
          narration: input.narration ?? null,
          ...posting,
          affectsTax,
          printSnapshot,
          lineDescription,
        },
      ),
    );

    audit({
      action: "receipt.post",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: posted.documentId,
      meta: {
        number: posted.number,
        amount: formatDecimal(input.amount),
        settlementKind,
        advanceSupply: settlementKind === "advance" ? input.advanceSupply : null,
      },
    });

    return getReceiptDetail(scope.orgId, posted.documentId);
  }),

  get: orgProcedure(
    { receipt: ["read"] },
    orgInput.extend({ receiptId: z.string().uuid() }),
  ).handler(({ context, input }) => getReceiptDetail(context.scope.orgId, input.receiptId)),

  list: orgProcedure(
    { receipt: ["read"] },
    orgInput
      .extend({
        q: searchQuery,
        partyId: z.string().uuid().optional(),
        paymentMethodIds: z.array(z.string().uuid()).min(1).max(20).optional(),
        state: z.enum(["posted", "cancelled"]).optional(),
        settlementKind: z.enum(SETTLEMENT_KINDS).optional(),
        ...period,
        cursor: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      })
      .superRefine(orderedPeriod),
  ).handler(async ({ context, input }) => {
    const pattern = input.q ? likePattern(input.q) : undefined;
    const partyName = sql<string | null>`${documents.printSnapshot}->'party'->>'name'`;

    // Only the columns a list row renders: a full document row is about 1 KB.
    const rows = await db
      .select({
        id: documents.id,
        number: documents.number,
        documentDate: documents.documentDate,
        state: documents.state,
        totalPaise: documents.totalPaise,
        reference: documents.reference,
        partyName,
        paymentMethodName: paymentMethods.name,
      })
      .from(documents)
      .innerJoin(
        paymentMethods,
        and(
          eq(paymentMethods.orgId, context.scope.orgId),
          eq(paymentMethods.id, documents.paymentMethodId),
        ),
      )
      .where(
        and(
          eq(documents.orgId, context.scope.orgId),
          eq(documents.type, "receipt"),
          input.cursor ? lt(documents.id, input.cursor) : undefined,
          input.partyId ? eq(documents.partyId, input.partyId) : undefined,
          input.paymentMethodIds
            ? inArray(documents.paymentMethodId, input.paymentMethodIds)
            : undefined,
          input.state ? eq(documents.state, input.state) : undefined,
          input.settlementKind ? eq(documents.settlementKind, input.settlementKind) : undefined,
          input.from ? gte(documents.documentDate, input.from) : undefined,
          input.to ? lte(documents.documentDate, input.to) : undefined,
          pattern
            ? or(
                ilike(documents.number, pattern),
                ilike(documents.reference, pattern),
                ilike(partyName, pattern),
              )
            : undefined,
        ),
      )
      .orderBy(desc(documents.id))
      .limit(input.limit + 1);

    const hasMore = rows.length > input.limit;

    return { rows: hasMore ? rows.slice(0, input.limit) : rows, hasMore };
  }),

  // The Parties list's money columns. A grouped read of its own, not columns on the
  // cached party master, so posting a receipt never refetches up to 5,000 parties.
  partyTotals: orgProcedure({ receipt: ["read"] }, orgInput).handler(async ({ context }) => {
    const rows = await db
      .select({
        partyId: documents.partyId,
        receiptCount: count(),
        receivedPaise: sql<bigint>`sum(${documents.totalPaise})::bigint`.mapWith(BigInt),
        lastReceiptDate: max(documents.documentDate),
      })
      .from(documents)
      .where(
        and(
          eq(documents.orgId, context.scope.orgId),
          eq(documents.type, "receipt"),
          eq(documents.state, "posted"),
          isNotNull(documents.partyId),
        ),
      )
      .groupBy(documents.partyId);

    return rows.map(({ partyId, receiptCount, receivedPaise, lastReceiptDate }) => {
      if (partyId === null || lastReceiptDate === null) {
        throw impossible("a receipt totals group without a party or date");
      }

      return { partyId, receiptCount, receivedPaise, lastReceiptDate };
    });
  }),

  cancel: orgProcedure(
    { receipt: ["cancel"] },
    orgInput.extend({ receiptId: z.string().uuid(), reason }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const settings = await readOrgSettings(scope.orgId);

    try {
      await db.transaction((tx) =>
        reverseDocument(tx, scope, settings, input.receiptId, input.reason),
      );
    } catch (error) {
      if (error instanceof DocumentNotFoundError) {
        throw new ORPCError("NOT_FOUND", { message: "Receipt not found." });
      }

      if (error instanceof DocumentAlreadyCancelledError) {
        throw new ORPCError("CONFLICT", {
          message: "This receipt is already cancelled.",
          data: { reason: "ALREADY_CANCELLED" },
        });
      }

      throw error;
    }

    const receipt = await getReceiptDetail(scope.orgId, input.receiptId);
    audit({
      action: "receipt.cancel",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: receipt.id,
      meta: {
        number: receipt.number,
        amount: formatDecimal(receipt.totalPaise),
        reason: input.reason,
      },
    });

    return receipt;
  }),
};
