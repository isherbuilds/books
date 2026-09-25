import { db, type DbTransaction } from "@accly/db";
import { allocations } from "@accly/db/schema/allocations";
import { DOCUMENT_STATES, documents, type DocumentType } from "@accly/db/schema/documents";
import { organizationSettings } from "@accly/db/schema/organization-settings";
import { paymentMethods } from "@accly/db/schema/payment-methods";
import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, gte, gt, ilike, inArray, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { allocationReversed, settlementPaise } from "../core/allocations";
import { amendDocument, postedNumber, reverseDocument } from "../core/documents";
import { formatDecimal } from "../core/money";
import type { DocumentPosting } from "../core/posting";
import { businessDate } from "./business-date";
import { impossible } from "./conflict";
import type { Scope } from "./procedures/factory";
import {
  documentListFields,
  likePattern,
  type draftToken,
  type settlementListFields,
} from "./schemas";

// Receipts and Payments share one read and list path. Invoices also share the cancel.
type PostedType = DocumentPosting["type"];

type DocumentListInput = z.output<z.ZodObject<typeof documentListFields>>;

type SettlementListInput = z.output<z.ZodObject<typeof settlementListFields>>;

/** The Invoice and Bill registers' filters. */
export const claimListFields = {
  ...documentListFields,
  state: z.enum(DOCUMENT_STATES).optional(),
  settlement: z.enum(["open", "overdue"]).optional(),
};

type ClaimListInput = z.output<z.ZodObject<typeof claimListFields>>;

type Claim = "invoice" | "bill";

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
export function documentListWhere(
  orgId: string,
  types: readonly DocumentType[],
  input: DocumentListInput,
) {
  const pattern = input.q ? likePattern(input.q) : undefined;

  return and(
    eq(documents.orgId, orgId),
    inArray(documents.type, [...types]),
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
    throw new ORPCError("NOT_FOUND", { message: `${type} not found.` });
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
  types: readonly PostedType[],
  documentId: string,
  reason: string,
): Promise<typeof documents.$inferSelect> {
  const cancelled = await db.transaction(async (tx) => {
    const settings = await orgSettings(scope.orgId, tx);

    return reverseDocument(tx, scope, settings, types, documentId, reason);
  });

  audit({
    action: `${cancelled.type}.cancel`,
    actorId: scope.userId,
    orgId: scope.orgId,
    target: `${cancelled.type}:${cancelled.id}`,
    meta: { number: cancelled.number, amount: formatDecimal(cancelled.totalPaise), reason },
  });

  return cancelled;
}

/** Cancels a posted Invoice or Bill and opens its copy as a draft. */
export async function amendClaim(
  scope: Scope,
  type: Claim,
  documentId: string,
  reason: string,
): Promise<{ id: string; version: number }> {
  const draft = await db.transaction(async (tx) => {
    const settings = await orgSettings(scope.orgId, tx);

    return amendDocument(tx, scope, settings, type, documentId, reason);
  });

  audit({
    action: `${type}.amend`,
    actorId: scope.userId,
    orgId: scope.orgId,
    target: `${type}:${documentId}`,
    meta: { draftId: draft.id, reason },
  });

  return draft;
}

/** Deletes a draft only at the version its editor loaded. */
export async function discardDraft(
  orgId: string,
  type: Claim,
  draft: z.output<typeof draftToken>,
): Promise<{ id: string }> {
  const [discarded] = await db
    .delete(documents)
    .where(
      and(
        eq(documents.orgId, orgId),
        eq(documents.id, draft.id),
        eq(documents.type, type),
        eq(documents.state, "draft"),
        eq(documents.version, draft.version),
      ),
    )
    .returning({ id: documents.id });

  if (!discarded) {
    throw new ORPCError("CONFLICT", { message: "This draft changed. Reload it and try again." });
  }

  return discarded;
}

/** One page of the Invoice or Bill register, each row with its settlement state. */
export async function listClaims(orgId: string, type: Claim, input: ClaimListInput) {
  // `overdue` compares due dates with today, so the time zone is read first.
  const today = businessDate(new Date(), await orgTimeZone(orgId));
  const { capacityPaise, balancePaise } = settlementPaise(orgId, "target");

  const page = await db
    .select({
      id: documents.id,
      number: documents.number,
      documentDate: documents.documentDate,
      dueDate: documents.dueDate,
      state: documents.state,
      totalPaise: documents.totalPaise,
      reference: documents.reference,
      partyName: printedPartyName,
      capacityPaise,
      outstandingPaise: balancePaise,
    })
    .from(documents)
    .where(
      and(
        documentListWhere(orgId, [type], input),
        input.state ? eq(documents.state, input.state) : undefined,
        input.settlement
          ? and(
              eq(documents.state, "posted"),
              gt(balancePaise, 0n),
              input.settlement === "overdue" ? lt(documents.dueDate, today) : undefined,
            )
          : undefined,
      ),
    )
    .orderBy(desc(documents.id))
    .limit(input.limit + 1);

  const { rows, hasMore } = pageOf(page, input.limit);

  return { rows: rows.map((row) => ({ ...row, ...documentSettlement(row, today) })), hasMore };
}

/**
 * A document's applies, oldest first, each naming the document on the other side.
 * `role` is this document's side of the allocation; `otherTypes` hides counterparts
 * the reader may not read.
 */
export async function allocationsOf(
  executor: typeof db | DbTransaction,
  orgId: string,
  documentId: string,
  role: "source" | "target",
  otherTypes?: readonly DocumentType[],
) {
  const [own, other] =
    role === "source"
      ? [allocations.sourceDocumentId, allocations.targetDocumentId]
      : [allocations.targetDocumentId, allocations.sourceDocumentId];

  const rows = await executor
    .select({
      id: allocations.id,
      otherDocumentId: documents.id,
      otherType: documents.type,
      otherNumber: documents.number,
      amountPaise: allocations.amountPaise,
      entryDate: allocations.entryDate,
      reversed: allocationReversed(orgId),
    })
    .from(allocations)
    .innerJoin(documents, and(eq(documents.orgId, orgId), eq(documents.id, other)))
    .where(
      and(
        eq(allocations.orgId, orgId),
        eq(own, documentId),
        eq(allocations.kind, "apply"),
        otherTypes ? inArray(documents.type, [...otherTypes]) : undefined,
      ),
    )
    .orderBy(asc(allocations.entryDate), asc(allocations.id));

  return rows.map((row) => ({
    ...row,
    otherNumber: postedNumber(row.otherNumber, row.otherDocumentId),
  }));
}

export async function listSettlements(orgId: string, type: PostedType, input: SettlementListInput) {
  const rows = await db
    .select({
      id: documents.id,
      number: documents.number,
      documentDate: documents.documentDate,
      state: documents.state,
      exposureSide: documents.exposureSide,
      settlementKind: documents.settlementKind,
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
        documentListWhere(orgId, [type], input),
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

/** Business-date settlement state for either side's claim. */
export function documentSettlement(
  document: {
    state: (typeof documents.$inferSelect)["state"];
    dueDate: string | null;
    capacityPaise: bigint;
    outstandingPaise: bigint;
  },
  today: string,
): { settlementStatus: "paid" | "partPaid" | "unpaid"; overdue: boolean } {
  const settlementStatus =
    document.outstandingPaise === 0n
      ? "paid"
      : document.outstandingPaise < document.capacityPaise
        ? "partPaid"
        : "unpaid";

  return {
    settlementStatus,
    overdue:
      document.state === "posted" &&
      settlementStatus !== "paid" &&
      document.dueDate !== null &&
      document.dueDate < today,
  };
}

/** The oldest claims still open for the party and side. */
export async function openItems(
  orgId: string,
  input: { partyId: string; side: "receivable" | "payable" },
) {
  const outstandingPaise = settlementPaise(orgId, "target").balancePaise;

  const types =
    input.side === "receivable" ? (["invoice", "payment"] as const) : (["bill"] as const);

  const rows = await db
    .select({
      id: documents.id,
      type: documents.type,
      number: documents.number,
      documentDate: documents.documentDate,
      dueDate: documents.dueDate,
      outstandingPaise,
    })
    .from(documents)
    .where(
      and(
        eq(documents.orgId, orgId),
        eq(documents.partyId, input.partyId),
        eq(documents.state, "posted"),
        inArray(documents.type, [...types]),
        input.side === "receivable"
          ? or(
              eq(documents.type, "invoice"),
              and(
                eq(documents.type, "payment"),
                eq(documents.settlementKind, "against"),
                eq(documents.exposureSide, "receivable"),
              ),
            )
          : undefined,
        gt(outstandingPaise, 0n),
      ),
    )
    .orderBy(asc(documents.documentDate), asc(documents.id))
    .limit(PICKER_LIMIT + 1);

  return pageOf(
    rows.map((row) => ({ ...row, number: postedNumber(row.number, row.id) })),
    PICKER_LIMIT,
  );
}

/** The oldest settling credits still available for the party and side. */
export async function openCredits(
  orgId: string,
  input: {
    partyId: string;
    side: "receivable" | "payable";
    type?: "receipt" | "creditNote" | "payment" | "debitNote";
  },
) {
  const unappliedPaise = settlementPaise(orgId, "source").balancePaise;

  const types =
    input.side === "receivable"
      ? (["receipt", "creditNote"] as const)
      : (["payment", "debitNote"] as const);

  const rows = await db
    .select({
      id: documents.id,
      type: documents.type,
      number: documents.number,
      documentDate: documents.documentDate,
      unappliedPaise,
    })
    .from(documents)
    .where(
      and(
        eq(documents.orgId, orgId),
        eq(documents.partyId, input.partyId),
        eq(documents.state, "posted"),
        inArray(documents.type, [...types]),
        input.type ? eq(documents.type, input.type) : undefined,
        input.side === "receivable"
          ? or(
              eq(documents.type, "creditNote"),
              and(
                eq(documents.type, "receipt"),
                inArray(documents.settlementKind, ["advance", "against"]),
              ),
            )
          : or(
              eq(documents.type, "debitNote"),
              and(
                eq(documents.type, "payment"),
                inArray(documents.settlementKind, ["advance", "against"]),
                eq(documents.exposureSide, "payable"),
              ),
            ),
        gt(unappliedPaise, 0n),
      ),
    )
    .orderBy(asc(documents.documentDate), asc(documents.id))
    .limit(PICKER_LIMIT + 1);

  return pageOf(
    rows.map((row) => ({ ...row, number: postedNumber(row.number, row.id) })),
    PICKER_LIMIT,
  );
}
