import { db, type DbTransaction } from "@accly/db";
import { documents, type DocumentType } from "@accly/db/schema/documents";
import { organizationSettings } from "@accly/db/schema/organization-settings";
import { paymentMethods } from "@accly/db/schema/payment-methods";
import { ORPCError } from "@orpc/server";
import { and, desc, eq, gte, ilike, inArray, lt, lte, or, sql } from "drizzle-orm";
import type { z } from "zod";

import { audit } from "../audit";
import { reverseDocument } from "../core/documents";
import { formatDecimal } from "../core/money";
import type { DocumentPosting } from "../core/posting";
import { impossible } from "./conflict";
import type { Scope } from "./procedures/factory";
import { likePattern, type documentListFields, type settlementListFields } from "./schemas";

// Receipts and Payments share one read and list path. Invoices also share the cancel.
type PostedType = DocumentPosting["type"];

type DocumentListInput = z.output<z.ZodObject<typeof documentListFields>>;

type SettlementListInput = z.output<z.ZodObject<typeof settlementListFields>>;

/** A picker lists the oldest open documents; later ones settle from their own record. */
export const PICKER_LIMIT = 200;

/** Splits rows fetched with `.limit(limit + 1)` into one page and an overflow flag. */
export function pageOf<T>(rows: T[], limit: number): { rows: T[]; hasMore: boolean } {
  return rows.length > limit
    ? { rows: rows.slice(0, limit), hasMore: true }
    : { rows, hasMore: false };
}

/** The party name printed on a document; registers show and search it. */
export const printedPartyName = sql<string | null>`${documents.printSnapshot}->'party'->>'name'`;

/** The keyset, party, period, number, reference, narration and party-name predicates every document register shares. */
export function documentListWhere(orgId: string, type: DocumentType, input: DocumentListInput) {
  const pattern = input.q ? likePattern(input.q) : undefined;

  return and(
    eq(documents.orgId, orgId),
    eq(documents.type, type),
    input.cursor ? lt(documents.id, input.cursor) : undefined,
    input.partyId ? eq(documents.partyId, input.partyId) : undefined,
    input.from ? gte(documents.documentDate, input.from) : undefined,
    input.to ? lte(documents.documentDate, input.to) : undefined,
    pattern
      ? or(
          ilike(documents.number, pattern),
          ilike(documents.reference, pattern),
          ilike(documents.narration, pattern),
          ilike(printedPartyName, pattern),
        )
      : undefined,
  );
}

export async function settlementDetail(
  orgId: string,
  type: PostedType,
  documentId: string,
): Promise<typeof documents.$inferSelect> {
  const [detail] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.orgId, orgId), eq(documents.id, documentId), eq(documents.type, type)))
    .limit(1);

  if (!detail) {
    throw new ORPCError("NOT_FOUND", {
      message: type === "receipt" ? "Receipt not found." : "Payment not found.",
    });
  }

  return detail;
}

export async function orgSettings(
  orgId: string,
  lock?: DbTransaction,
  mode: "share" | "update" = "share",
): Promise<typeof organizationSettings.$inferSelect> {
  const query = (lock ?? db)
    .select()
    .from(organizationSettings)
    .where(eq(organizationSettings.orgId, orgId))
    .limit(1);

  // Hold settings and lock dates stable until the writer commits. Exclusive readers
  // serialize Opening Balance posts and exception revocation against those writers.
  const [settings] = lock ? await query.for(mode) : await query;

  if (!settings) throw impossible(`organization ${orgId} is missing its settings`);

  return settings;
}

/** The Organization's time zone, which dates a cancellation and a default document date. */
export async function orgTimeZone(orgId: string): Promise<string> {
  return (await orgSettings(orgId)).timeZone;
}

// The audit runs after the commit, so it never slows or fails the cancel.
export async function cancelDocument(
  scope: Scope,
  type: PostedType,
  documentId: string,
  reason: string,
): Promise<typeof documents.$inferSelect> {
  const cancelled = await db.transaction(async (tx) => {
    const settings = await orgSettings(scope.orgId, tx);

    return reverseDocument(tx, scope, settings, type, documentId, reason);
  });

  audit({
    action: `${type}.cancel`,
    actorId: scope.userId,
    orgId: scope.orgId,
    target: cancelled.id,
    meta: { number: cancelled.number, amount: formatDecimal(cancelled.totalPaise), reason },
  });

  return cancelled;
}

export async function listSettlements(orgId: string, type: PostedType, input: SettlementListInput) {
  const rows = await db
    .select({
      id: documents.id,
      number: documents.number,
      documentDate: documents.documentDate,
      state: documents.state,
      totalPaise: documents.totalPaise,
      reference: documents.reference,
      partyName: printedPartyName,
      paymentMethodName: paymentMethods.name,
    })
    .from(documents)
    .innerJoin(
      paymentMethods,
      and(eq(paymentMethods.orgId, orgId), eq(paymentMethods.id, documents.paymentMethodId)),
    )
    .where(
      and(
        documentListWhere(orgId, type, input),
        input.paymentMethodIds
          ? inArray(documents.paymentMethodId, input.paymentMethodIds)
          : undefined,
        input.state ? eq(documents.state, input.state) : undefined,
        input.settlementKind ? eq(documents.settlementKind, input.settlementKind) : undefined,
      ),
    )
    .orderBy(desc(documents.id))
    .limit(input.limit + 1);

  return pageOf(rows, input.limit);
}
