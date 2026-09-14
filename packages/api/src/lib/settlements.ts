import { db } from "@accly/db";
import { documents } from "@accly/db/schema/documents";
import { organizationSettings } from "@accly/db/schema/organization-settings";
import { paymentMethods } from "@accly/db/schema/payment-methods";
import { ORPCError } from "@orpc/server";
import { and, desc, eq, gte, ilike, inArray, lt, lte, or, sql } from "drizzle-orm";
import type { z } from "zod";

import { audit } from "../audit";
import { reverseDocument } from "../core/documents";
import { formatDecimal } from "../core/money";
import type { DocumentPosting } from "../core/posting";
import type { Scope } from "./procedures/factory";
import { likePattern, type settlementListFields } from "./schemas";

// Receipts and Payments share one read, list and cancel path; only the type differs.
type SettlementType = DocumentPosting["type"];

type SettlementListInput = z.output<z.ZodObject<typeof settlementListFields>>;

export async function settlementDetail(
  orgId: string,
  type: SettlementType,
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

/** The Organization's time zone, which dates a cancellation and a default document date. */
export async function orgTimeZone(orgId: string): Promise<string> {
  const [row] = await db
    .select({ timeZone: organizationSettings.timeZone })
    .from(organizationSettings)
    .where(eq(organizationSettings.orgId, orgId))
    .limit(1);

  if (!row) throw new Error(`Organization ${orgId} is missing its settings`);

  return row.timeZone;
}

// The audit runs after the commit, so it never slows or fails the cancel.
export async function cancelSettlement(
  scope: Scope,
  type: SettlementType,
  documentId: string,
  reason: string,
): Promise<typeof documents.$inferSelect> {
  const timeZone = await orgTimeZone(scope.orgId);

  const cancelled = await db.transaction((tx) =>
    reverseDocument(tx, scope, timeZone, type, documentId, reason),
  );

  audit({
    action: `${type}.cancel`,
    actorId: scope.userId,
    orgId: scope.orgId,
    target: cancelled.id,
    meta: { number: cancelled.number, amount: formatDecimal(cancelled.totalPaise), reason },
  });

  return cancelled;
}

export async function listSettlements(
  orgId: string,
  type: SettlementType,
  input: SettlementListInput,
) {
  const pattern = input.q ? likePattern(input.q) : undefined;
  const partyName = sql<string | null>`${documents.printSnapshot}->'party'->>'name'`;

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
      and(eq(paymentMethods.orgId, orgId), eq(paymentMethods.id, documents.paymentMethodId)),
    )
    .where(
      and(
        eq(documents.orgId, orgId),
        eq(documents.type, type),
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
}
