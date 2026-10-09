import { db, type DbTransaction } from "@accly/db";
import { allocations } from "@accly/db/schema/allocations";
import { documentLines } from "@accly/db/schema/document-lines";
import {
  DOCUMENT_STATES,
  DOCUMENT_TYPES,
  documents,
  type DocumentType,
} from "@accly/db/schema/documents";
import { partyLedgerLines } from "@accly/db/schema/party-ledger-lines";
import { paymentMethods } from "@accly/db/schema/payment-methods";
import { tdsSections } from "@accly/db/schema/tds-sections";
import { tdsDeductions } from "@accly/db/schema/tds-deductions";
import { ORPCError } from "@orpc/server";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gte,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";

import { audit } from "@accly/db/audit";
import { allocationReversed, settlementPaise } from "../core/allocations";
import { documentRole, type Side } from "../core/document-roles";
import { amendDocument, postedNumber, reverseDocument } from "../core/documents";
import { formatDecimal } from "../core/money";
import type { DocumentPosting } from "../core/posting";
import { businessDate } from "./business-date";
import { badRequest, impossible } from "./conflict";
import { orgSettings, orgTimeZone } from "./org-settings";
import { dateCursor, documentCursorOf, pageOf } from "./pagination";
import type { Scope } from "./procedures/factory";
import {
  documentFilterFields,
  documentListFields,
  likePattern,
  type DocumentCursor,
  type draftToken,
  type settlementFilterFields,
} from "./schemas";
import { paiseSum } from "./sql";

// Receipts and Payments share one read and list path. Invoices also share the cancel.
type PostedType = DocumentPosting["type"];

type DocumentListInput = z.output<z.ZodObject<typeof documentListFields>>;

type DocumentFilterInput = z.output<z.ZodObject<typeof documentFilterFields>>;

type SettlementFilterInput = z.output<z.ZodObject<typeof settlementFilterFields>>;

/** The Invoice and Bill registers' status: a state, or a posted claim still open. */
const claimStatus = z.enum([...DOCUMENT_STATES, "open", "overdue"]).optional();

export const claimFilterFields = { ...documentFilterFields, status: claimStatus };

export const claimListFields = { ...documentListFields, status: claimStatus };

type ClaimListInput = z.output<z.ZodObject<typeof claimListFields>>;

type ClaimFilterInput = z.output<z.ZodObject<typeof claimFilterFields>>;

type Claim = "invoice" | "bill";

/** The party name printed on a document; registers show it and `searchText` holds it. */
export const printedPartyName = sql<string | null>`${documents.printSnapshot}->'party'->>'name'`;

/** A list's date range. A draft is unfinished work, so no period hides it. */
export function documentPeriod(input: { from?: string; to?: string }) {
  if (!input.from && !input.to) return undefined;

  return or(
    eq(documents.state, "draft"),
    and(
      input.from ? gte(documents.documentDate, input.from) : undefined,
      input.to ? lte(documents.documentDate, input.to) : undefined,
    ),
  );
}

/** The keyset, party and period predicates every document register shares. */
export function documentListWhere(
  orgId: string,
  types: readonly DocumentType[],
  input: DocumentFilterInput,
  cursor?: SQL,
) {
  // Only Invoices and Bills have drafts outside the period. An unnecessary draft
  // OR prevents the other registers from seeking their date range in the index.
  return and(
    eq(documents.orgId, orgId),
    inArray(documents.type, [...types]),
    cursor,
    input.partyId ? eq(documents.partyId, input.partyId) : undefined,
    types.some((type) => type === "invoice" || type === "bill")
      ? documentPeriod(input)
      : and(
          input.from ? gte(documents.documentDate, input.from) : undefined,
          input.to ? lte(documents.documentDate, input.to) : undefined,
        ),
  );
}

/**
 * Totals share the page's tenant, type, period, party and search predicate. They count
 * posted documents only, unless the user filters to drafts or cancelled ones.
 */
function totalsWhere(
  orgId: string,
  types: readonly DocumentType[],
  input: DocumentFilterInput,
  filter: SQL | undefined,
) {
  return and(
    documentListWhere(orgId, types, input),
    input.q ? ilike(documents.searchText, likePattern(input.q)) : undefined,
    filter ?? eq(documents.state, "posted"),
  );
}

/** Receipt and Payment totals, split by payment method. */
export async function settlementTotals(
  orgId: string,
  type: "receipt" | "payment",
  input: SettlementFilterInput,
) {
  const methods = await db
    .select({
      name: paymentMethods.name,
      count: sql<number>`count(*)::int`.mapWith(Number),
      amountPaise: paiseSum(documents.totalPaise),
    })
    .from(documents)
    .innerJoin(
      paymentMethods,
      and(eq(paymentMethods.orgId, orgId), eq(paymentMethods.id, documents.paymentMethodId)),
    )
    .where(
      totalsWhere(
        orgId,
        [type],
        input,
        and(settlementListWhere(input), input.state ? undefined : eq(documents.state, "posted")),
      ),
    )
    .groupBy(paymentMethods.id, paymentMethods.name)
    .orderBy(paymentMethods.name);

  return {
    count: methods.reduce((count, method) => count + method.count, 0),
    totalPaise: methods.reduce((total, method) => total + method.amountPaise, 0n),
    methods,
  };
}

// A search first walks this many of the newest documents, then reads the trigram
// index for older ones only if the page is not full.
const SEARCH_WINDOW = 1_000;

/**
 * One register page, newest document date first. `read` runs the register's own query
 * with `where` and its own filters, ordered by `(document_date, id)` descending and
 * limited to `limit + 1`. The cursor is the last row's `(documentDate, id)` (`dateCursor`).
 *
 * A search term matches a substring of `documents.search_text`. PostgreSQL estimates
 * that match across every organization, so a term common elsewhere or in old history
 * can make it walk a whole register that holds no match, and a forced index read
 * collects every match of a common term. So the search walks the newest
 * `SEARCH_WINDOW` documents, and reads the index for older documents only when that
 * page is not full. `documentSearchQuery` guarantees the term has a trigram.
 */
export async function registerPage<T extends { documentDate: string; id: string }>(
  orgId: string,
  types: readonly DocumentType[],
  input: DocumentListInput,
  read: (where: SQL | undefined) => PromiseLike<T[]>,
) {
  const cursor = dateCursor(input.cursor, "before");
  const listed = documentListWhere(orgId, types, input, cursor);

  if (!input.q) return pageOf(await read(listed), input.limit, documentCursorOf);

  const matches = ilike(documents.searchText, likePattern(input.q));

  const [edge] = await db
    .select({ id: documents.id, documentDate: documents.documentDate })
    .from(documents)
    .where(and(eq(documents.orgId, orgId), inArray(documents.type, [...types]), cursor))
    .orderBy(desc(documents.documentDate), desc(documents.id))
    .offset(SEARCH_WINDOW - 1)
    .limit(1);

  const edgePosition = edge ? sql`(${edge.documentDate}::date, ${edge.id})` : undefined;

  const recent = await read(
    and(
      listed,
      matches,
      edgePosition
        ? sql`(${documents.documentDate}, ${documents.id}) >= ${edgePosition}`
        : undefined,
    ),
  );

  if (!edge || recent.length > input.limit) return pageOf(recent, input.limit, documentCursorOf);

  // `= any(array(…))` runs the index read once, whole, instead of letting the planner
  // walk the register again.
  const older = db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.orgId, orgId),
        inArray(documents.type, [...types]),
        sql`(${documents.documentDate}, ${documents.id}) < ${edgePosition}`,
        matches,
      ),
    );

  const rest = await read(
    and(
      listed,
      sql`(${documents.documentDate}, ${documents.id}) < ${edgePosition}`,
      sql`${documents.id} = any(array(${older}))`,
    ),
  );

  return pageOf([...recent, ...rest], input.limit, documentCursorOf);
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

// The audit runs after the commit, so it never slows or fails the cancel.
export async function cancelDocument(
  scope: Scope,
  types: readonly PostedType[],
  documentId: string,
  reason: string,
  reverse: typeof reverseDocument = reverseDocument,
): Promise<typeof documents.$inferSelect> {
  const cancelled = await db.transaction(async (tx) => {
    const settings = await orgSettings(scope.orgId, tx);

    return reverse(tx, scope, settings, types, documentId, reason);
  });

  // The update matched one of `types`; finding it narrows the stored type for the action.
  const type = types.find((candidate) => candidate === cancelled.type);

  if (!type)
    throw impossible(`cancelled ${cancelled.type} ${cancelled.id} is not a ${types.join(" or ")}`);

  audit({
    action: `${type}.cancel`,
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
  const { capacityPaise, balancePaise } = settlementPaise(orgId, "target", null);

  const { rows, nextCursor } = await registerPage(orgId, [type], input, (listed) =>
    db
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
      .where(and(listed, claimListWhere(orgId, input, today)))
      .orderBy(desc(documents.documentDate), desc(documents.id))
      .limit(input.limit + 1),
  );

  // Capacity and outstanding only decide the status; the register shows the status.
  return {
    rows: rows.map(({ capacityPaise, outstandingPaise, ...row }) => ({
      ...row,
      ...documentSettlement({ ...row, capacityPaise, outstandingPaise }, today),
    })),
    nextCursor,
  };
}

/** Keep open/overdue and state filters identical for pages and aggregates. */
export function claimListWhere(
  orgId: string,
  input: Pick<ClaimFilterInput, "status">,
  today: string,
) {
  if (input.status === "open" || input.status === "overdue") {
    return and(
      eq(documents.state, "posted"),
      gt(settlementPaise(orgId, "target", null).balancePaise, 0n),
      input.status === "overdue" ? lt(documents.dueDate, today) : undefined,
    );
  }

  return input.status ? eq(documents.state, input.status) : undefined;
}

/** Invoice and Bill totals. */
export async function claimTotals(orgId: string, type: Claim, input: ClaimFilterInput) {
  const today = businessDate(new Date(), await orgTimeZone(orgId));

  const [totals] = await db
    .select({
      count: sql<number>`count(*)::int`.mapWith(Number),
      totalPaise: paiseSum(documents.totalPaise),
    })
    .from(documents)
    .where(totalsWhere(orgId, [type], input, claimListWhere(orgId, input, today)));

  if (!totals) throw impossible("register aggregate returned no row");

  return totals;
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
      otherDocumentDate: documents.documentDate,
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

/** The columns every Receipt and Payment register row carries. */
export const settlementListRow = {
  id: documents.id,
  number: documents.number,
  documentDate: documents.documentDate,
  state: documents.state,
  totalPaise: documents.totalPaise,
  partyName: printedPartyName,
};

/** The Receipt and Payment registers' own filters, beside `registerPage`'s. */
export function settlementListWhere(
  input: Pick<SettlementFilterInput, "paymentMethodIds" | "state" | "settlementKind">,
) {
  return and(
    input.paymentMethodIds ? inArray(documents.paymentMethodId, input.paymentMethodIds) : undefined,
    input.state ? eq(documents.state, input.state) : undefined,
    input.settlementKind ? eq(documents.settlementKind, input.settlementKind) : undefined,
  );
}

/** A refund pays out exactly the credits it names, whichever side it settles. */
export function assertRefundAmount(amountPaise: bigint, creditsPaise: bigint): void {
  if (creditsPaise !== amountPaise)
    throw badRequest(
      "REFUND_AMOUNT_MISMATCH",
      "The refund amount must equal the total of the credits you picked.",
    );
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

type PickerPage = { cursor?: DocumentCursor; limit: number };

/** One page of the claims still open for the party and side, oldest first. */
export async function openItems(
  orgId: string,
  input: PickerPage & { partyId: string; side: "receivable" | "payable"; type?: "invoice" },
  canReadJournals: boolean,
) {
  const outstandingPaise = settlementPaise(orgId, "target", input.partyId).balancePaise;

  const rows = await db
    .select({
      id: documents.id,
      type: documents.type,
      number: documents.number,
      reference: documents.reference,
      documentDate: documents.documentDate,
      dueDate: documents.dueDate,
      outstandingPaise,
    })
    .from(documents)
    .where(
      and(
        eq(documents.orgId, orgId),
        or(
          eq(documents.partyId, input.partyId),
          and(
            eq(documents.type, "journal"),
            exists(
              db
                .select({ id: partyLedgerLines.id })
                .from(partyLedgerLines)
                .where(
                  and(
                    eq(partyLedgerLines.orgId, orgId),
                    eq(partyLedgerLines.documentId, documents.id),
                    eq(partyLedgerLines.partyId, input.partyId),
                    eq(partyLedgerLines.kind, "post"),
                    eq(partyLedgerLines.side, "receivable"),
                    gt(partyLedgerLines.amountPaise, 0n),
                  ),
                ),
            ),
          ),
        ),
        eq(documents.state, "posted"),
        input.type ? eq(documents.type, input.type) : undefined,
        hasRole("target", input.side),
        canReadJournals ? undefined : ne(documents.type, "journal"),
        dateCursor(input.cursor, "after"),
        gt(outstandingPaise, 0n),
      ),
    )
    .orderBy(asc(documents.documentDate), asc(documents.id))
    .limit(input.limit + 1);

  return pageOf(
    rows.map((row) => ({ ...row, number: postedNumber(row.number, row.id) })),
    input.limit,
    documentCursorOf,
  );
}

/**
 * One page of the settling credits still available for the party and side, oldest
 * first. `q` narrows by document number, so every credit is one search away.
 */
export async function openCredits(
  orgId: string,
  input: PickerPage & {
    partyId: string;
    side: "receivable" | "payable";
    types?: readonly ("receipt" | "creditNote" | "payment" | "debitNote" | "journal")[];
    tdsOnly?: boolean;
    q?: string;
  },
) {
  const unappliedPaise = settlementPaise(orgId, "source", input.partyId).balancePaise;

  const rows = await db
    .select({
      id: documents.id,
      type: documents.type,
      number: documents.number,
      reference: documents.reference,
      documentDate: documents.documentDate,
      unappliedPaise,
    })
    .from(documents)
    .where(
      and(
        eq(documents.orgId, orgId),
        or(
          eq(documents.partyId, input.partyId),
          and(
            eq(documents.type, "journal"),
            exists(
              db
                .select({ id: partyLedgerLines.id })
                .from(partyLedgerLines)
                .where(
                  and(
                    eq(partyLedgerLines.orgId, orgId),
                    eq(partyLedgerLines.documentId, documents.id),
                    eq(partyLedgerLines.partyId, input.partyId),
                    eq(partyLedgerLines.kind, "post"),
                    eq(partyLedgerLines.side, "receivable"),
                    lt(partyLedgerLines.amountPaise, 0n),
                  ),
                ),
            ),
          ),
        ),
        eq(documents.state, "posted"),
        input.types ? inArray(documents.type, [...input.types]) : undefined,
        hasRole("source", input.side),
        input.tdsOnly
          ? exists(
              db
                .select({ id: tdsDeductions.id })
                .from(tdsDeductions)
                .where(
                  and(
                    eq(tdsDeductions.orgId, orgId),
                    eq(tdsDeductions.documentId, documents.id),
                    gt(tdsDeductions.amountPaise, 0n),
                  ),
                ),
            )
          : undefined,
        input.q
          ? or(
              ilike(documents.number, likePattern(input.q)),
              ilike(documents.reference, likePattern(input.q)),
            )
          : undefined,
        dateCursor(input.cursor, "after"),
        gt(unappliedPaise, 0n),
      ),
    )
    .orderBy(asc(documents.documentDate), asc(documents.id))
    .limit(input.limit + 1);

  return pageOf(
    rows.map((row) => ({ ...row, number: postedNumber(row.number, row.id) })),
    input.limit,
    documentCursorOf,
  );
}

/** A Receipt's or Payment's fee, write-off and TDS lines, in entry order. */
export function adjustmentLinesOf(orgId: string, documentId: string) {
  return db
    .select({
      id: documentLines.id,
      adjustmentKind: documentLines.adjustmentKind,
      amountPaise: documentLines.amountPaise,
      sectionCode: tdsSections.code,
    })
    .from(documentLines)
    .leftJoin(
      tdsSections,
      and(eq(tdsSections.orgId, orgId), eq(tdsSections.id, documentLines.tdsSectionId)),
    )
    .where(
      and(
        eq(documentLines.orgId, orgId),
        eq(documentLines.documentId, documentId),
        isNotNull(documentLines.adjustmentKind),
      ),
    )
    .orderBy(asc(documentLines.position));
}

/** documentRole() as a condition on `documents`: rows that are a source or target on `side`. */
function hasRole(position: "source" | "target", side: Side): SQL | undefined {
  return or(
    ...DOCUMENT_TYPES.flatMap((type) =>
      (["receivable", "payable", null] as const).flatMap((exposureSide) =>
        documentRole({ type, exposureSide })[position] === side
          ? [
              and(
                eq(documents.type, type),
                exposureSide === null
                  ? isNull(documents.exposureSide)
                  : eq(documents.exposureSide, exposureSide),
              ),
            ]
          : [],
      ),
    ),
  );
}
