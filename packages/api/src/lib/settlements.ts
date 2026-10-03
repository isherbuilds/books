import { db, type DbTransaction } from "@accly/db";
import { allocations } from "@accly/db/schema/allocations";
import { documentLines } from "@accly/db/schema/document-lines";
import { DOCUMENT_STATES, documents, type DocumentType } from "@accly/db/schema/documents";
import { organizationSettings } from "@accly/db/schema/organization-settings";
import { partyLedgerLines } from "@accly/db/schema/party-ledger-lines";
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
  lt,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
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

/** The Invoice and Bill registers' filters. A status is a state, or a posted claim still open. */
export const claimListFields = {
  ...documentListFields,
  status: z.enum([...DOCUMENT_STATES, "open", "overdue"]).optional(),
};

type ClaimListInput = z.output<z.ZodObject<typeof claimListFields>>;

type Claim = "invoice" | "bill";

/** Splits rows fetched with `.limit(limit + 1)` into one page and an overflow flag. */
export function pageOf<T>(rows: T[], limit: number): { rows: T[]; hasMore: boolean } {
  return rows.length > limit
    ? { rows: rows.slice(0, limit), hasMore: true }
    : { rows, hasMore: false };
}

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
function documentListWhere(
  orgId: string,
  types: readonly DocumentType[],
  input: DocumentListInput,
) {
  return and(
    eq(documents.orgId, orgId),
    inArray(documents.type, [...types]),
    input.cursor ? lt(documents.id, input.cursor) : undefined,
    input.partyId ? eq(documents.partyId, input.partyId) : undefined,
    documentPeriod(input),
  );
}

// A search first walks this many of the newest documents, then reads the trigram
// index for older ones only if the page is not full.
const SEARCH_WINDOW = 1_000;

/**
 * One register page, newest first. `read` runs the register's own query with `where`
 * and any filters of its own, ordered by `id` descending and limited to `limit + 1`.
 *
 * A search term matches a substring of `documents.search_text`. PostgreSQL estimates
 * that match across every organization, so a term common elsewhere or in old history
 * can make it walk a whole register that holds no match, and a forced index read
 * collects every match of a common term. So the search walks the newest
 * `SEARCH_WINDOW` documents, and reads the index for older documents only when that
 * page is not full. `documentSearchQuery` guarantees the term has a trigram.
 */
export async function registerPage<T>(
  orgId: string,
  types: readonly DocumentType[],
  input: DocumentListInput,
  read: (where: SQL | undefined) => PromiseLike<T[]>,
): Promise<{ rows: T[]; hasMore: boolean }> {
  const listed = documentListWhere(orgId, types, input);

  if (!input.q) return pageOf(await read(listed), input.limit);

  const matches = ilike(documents.searchText, likePattern(input.q));

  const [edge] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.orgId, orgId),
        inArray(documents.type, [...types]),
        input.cursor ? lt(documents.id, input.cursor) : undefined,
      ),
    )
    .orderBy(desc(documents.id))
    .offset(SEARCH_WINDOW - 1)
    .limit(1);

  const recent = await read(and(listed, matches, edge ? gte(documents.id, edge.id) : undefined));

  if (!edge || recent.length > input.limit) return pageOf(recent, input.limit);

  // `= any(array(…))` runs the index read once, whole, instead of letting the planner
  // walk the register again.
  const older = db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.orgId, orgId),
        inArray(documents.type, [...types]),
        lt(documents.id, edge.id),
        matches,
      ),
    );

  const rest = await read(
    and(listed, lt(documents.id, edge.id), sql`${documents.id} = any(array(${older}))`),
  );

  return pageOf([...recent, ...rest], input.limit);
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
  reverse: typeof reverseDocument = reverseDocument,
): Promise<typeof documents.$inferSelect> {
  const cancelled = await db.transaction(async (tx) => {
    const settings = await orgSettings(scope.orgId, tx);

    return reverse(tx, scope, settings, types, documentId, reason);
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
  const { capacityPaise, balancePaise } = settlementPaise(orgId, "target", null);

  const { rows, hasMore } = await registerPage(orgId, [type], input, (listed) =>
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
      .where(
        and(
          listed,
          input.status === "open" || input.status === "overdue"
            ? and(
                eq(documents.state, "posted"),
                gt(balancePaise, 0n),
                input.status === "overdue" ? lt(documents.dueDate, today) : undefined,
              )
            : input.status
              ? eq(documents.state, input.status)
              : undefined,
        ),
      )
      .orderBy(desc(documents.id))
      .limit(input.limit + 1),
  );

  // Capacity and outstanding only decide the status; the register shows the status.
  return {
    rows: rows.map(({ capacityPaise, outstandingPaise, ...row }) => ({
      ...row,
      ...documentSettlement({ ...row, capacityPaise, outstandingPaise }, today),
    })),
    hasMore,
  };
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
export function settlementListWhere(input: SettlementListInput) {
  return and(
    input.paymentMethodIds ? inArray(documents.paymentMethodId, input.paymentMethodIds) : undefined,
    input.state ? eq(documents.state, input.state) : undefined,
    input.settlementKind ? eq(documents.settlementKind, input.settlementKind) : undefined,
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

type PickerPage = { cursor?: string; limit: number };

/**
 * Rows after the cursor document in oldest-first (date, id) order, for the pickers and
 * the opening items. A posted document's date never changes, so a cursor keeps its
 * place between pages.
 */
export function afterDateCursor(orgId: string, cursor: string | undefined) {
  if (!cursor) return undefined;

  const position = db
    .select({ documentDate: documents.documentDate, id: documents.id })
    .from(documents)
    .where(and(eq(documents.orgId, orgId), eq(documents.id, cursor)));

  return sql`(${documents.documentDate}, ${documents.id}) > (${position})`;
}

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
        input.side === "receivable"
          ? or(
              eq(documents.type, "invoice"),
              canReadJournals ? eq(documents.type, "journal") : undefined,
              and(
                eq(documents.type, "payment"),
                eq(documents.settlementKind, "against"),
                eq(documents.exposureSide, "receivable"),
              ),
              and(eq(documents.type, "openingClaim"), eq(documents.exposureSide, "receivable")),
            )
          : or(
              eq(documents.type, "bill"),
              and(eq(documents.type, "openingClaim"), eq(documents.exposureSide, "payable")),
            ),
        afterDateCursor(orgId, input.cursor),
        gt(outstandingPaise, 0n),
      ),
    )
    .orderBy(asc(documents.documentDate), asc(documents.id))
    .limit(input.limit + 1);

  return pageOf(
    rows.map((row) => ({ ...row, number: postedNumber(row.number, row.id) })),
    input.limit,
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
    type?: "receipt" | "creditNote" | "payment" | "debitNote" | "journal";
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
        input.type ? eq(documents.type, input.type) : undefined,
        input.side === "receivable"
          ? or(
              eq(documents.type, "journal"),
              eq(documents.type, "creditNote"),
              and(
                eq(documents.type, "receipt"),
                inArray(documents.settlementKind, ["advance", "against"]),
              ),
              and(eq(documents.type, "openingCredit"), eq(documents.exposureSide, "receivable")),
            )
          : or(
              eq(documents.type, "debitNote"),
              and(
                eq(documents.type, "payment"),
                inArray(documents.settlementKind, ["advance", "against"]),
                eq(documents.exposureSide, "payable"),
              ),
              and(eq(documents.type, "openingCredit"), eq(documents.exposureSide, "payable")),
            ),
        input.q
          ? or(
              ilike(documents.number, likePattern(input.q)),
              ilike(documents.reference, likePattern(input.q)),
            )
          : undefined,
        afterDateCursor(orgId, input.cursor),
        gt(unappliedPaise, 0n),
      ),
    )
    .orderBy(asc(documents.documentDate), asc(documents.id))
    .limit(input.limit + 1);

  return pageOf(
    rows.map((row) => ({ ...row, number: postedNumber(row.number, row.id) })),
    input.limit,
  );
}

/** A Receipt's or Payment's fee, write-off and TDS lines, in entry order. */
export function adjustmentLinesOf(orgId: string, documentId: string) {
  return db
    .select({
      id: documentLines.id,
      adjustmentKind: documentLines.adjustmentKind,
      amountPaise: documentLines.amountPaise,
    })
    .from(documentLines)
    .where(
      and(
        eq(documentLines.orgId, orgId),
        eq(documentLines.documentId, documentId),
        isNotNull(documentLines.adjustmentKind),
      ),
    )
    .orderBy(asc(documentLines.position));
}
