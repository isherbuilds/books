import { authorize, type AppPermission } from "@accly/auth/access";
import { db } from "@accly/db";
import type { DbTransaction } from "@accly/db";
import { documents } from "@accly/db/schema/documents";
import { parties } from "@accly/db/schema/parties";
import { partyLedgerLines } from "@accly/db/schema/party-ledger-lines";
import { tdsDeductions } from "@accly/db/schema/tds-deductions";
import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, gte, ilike, inArray, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";

import { claimParties, createParties, partyInputFields, partyValues } from "../core/masters";
import { businessDate } from "../lib/business-date";
import { conflict, impossible, nextEditToken } from "../lib/conflict";
import { MASTER_LIST_LIMIT } from "../lib/master-list";
import { documentLabel } from "../lib/document-labels";
import { orgInput, orgProcedure, requirePermission } from "../lib/procedures/factory";
import {
  afterCursor,
  headerFromProfile,
  reportProfile,
  assertReportFits,
  reportTooLarge,
  type ReportHeader,
} from "../lib/reports";
import { documentPeriod, openCredits, openItems, pageOf } from "../lib/settlements";
import {
  documentCursor,
  editToken,
  deriveFromGstin,
  likePattern,
  ledgerCursor,
  orderedPeriod,
  pageLimit,
  period,
  searchQuery,
} from "../lib/schemas";

export type PartyRecord = typeof parties.$inferSelect;

const STATEMENT_LIMIT = 5000;

// The documents a party's Transactions tab lists, each shown only to a reader of its
// type: an operator sees invoices, receipts and payments, but no bills or notes.
const TRANSACTION_TYPES = [
  "invoice",
  "bill",
  "creditNote",
  "debitNote",
  "receipt",
  "payment",
  "openingClaim",
  "openingCredit",
] as const;

type TransactionType = (typeof TRANSACTION_TYPES)[number];

const TRANSACTION_READS: Record<TransactionType, AppPermission> = {
  invoice: { invoice: ["read"] },
  bill: { bill: ["read"] },
  creditNote: { note: ["read"] },
  debitNote: { note: ["read"] },
  receipt: { receipt: ["read"] },
  payment: { payment: ["read"] },
  openingClaim: { openingBalance: ["read"] },
  openingCredit: { openingBalance: ["read"] },
};

async function requireParty(
  orgId: string,
  partyId: string,
): Promise<Pick<PartyRecord, "name" | "gstin" | "address" | "stateCode">> {
  const [party] = await db
    .select({
      name: parties.name,
      gstin: parties.gstin,
      address: parties.address,
      stateCode: parties.stateCode,
    })
    .from(parties)
    .where(and(eq(parties.orgId, orgId), eq(parties.id, partyId)))
    .limit(1);

  if (!party) throw new ORPCError("NOT_FOUND", { message: "Party not found." });

  return party;
}

export type PartyStatementReport = {
  header: ReportHeader;
  party: Pick<PartyRecord, "name" | "gstin" | "address" | "stateCode">;
  openingPaise: bigint;
  lines: Array<{
    id: string;
    entryDate: string;
    kind: (typeof partyLedgerLines.$inferSelect)["kind"];
    amountPaise: bigint;
    documentId: string;
    documentType: (typeof documents.$inferSelect)["type"];
    number: string | null;
    settlementKind: (typeof documents.$inferSelect)["settlementKind"];
    reference: string | null;
    tdsPaise: bigint | null;
    typeLabel: string;
    balancePaise: bigint;
  }>;
  closingPaise: bigint;
};

function partyStatementRows(
  orgId: string,
  input: { partyId: string; from?: string; to?: string; cursor?: z.infer<typeof ledgerCursor> },
  limit: number,
  executor: typeof db | DbTransaction = db,
) {
  return executor
    .select({
      id: partyLedgerLines.id,
      entryDate: partyLedgerLines.entryDate,
      kind: partyLedgerLines.kind,
      amountPaise: partyLedgerLines.amountPaise,
      documentId: documents.id,
      documentType: documents.type,
      number: documents.number,
      settlementKind: documents.settlementKind,
      reference: documents.reference,
      side: partyLedgerLines.side,
      tdsPaise: tdsDeductions.amountPaise,
    })
    .from(partyLedgerLines)
    .innerJoin(
      documents,
      and(eq(documents.orgId, orgId), eq(documents.id, partyLedgerLines.documentId)),
    )
    .leftJoin(
      tdsDeductions,
      and(
        eq(tdsDeductions.orgId, orgId),
        eq(tdsDeductions.documentId, documents.id),
        inArray(documents.type, ["bill", "debitNote"]),
      ),
    )
    .where(
      and(
        partyStatementWhere(orgId, input),
        input.cursor
          ? afterCursor(partyLedgerLines.entryDate, partyLedgerLines.id, input.cursor)
          : undefined,
      ),
    )
    .orderBy(asc(partyLedgerLines.entryDate), asc(partyLedgerLines.id))
    .limit(limit + 1);
}

function partyStatementWhere(
  orgId: string,
  input: { partyId: string; from?: string; to?: string },
) {
  return and(
    eq(partyLedgerLines.orgId, orgId),
    eq(partyLedgerLines.partyId, input.partyId),
    input.from ? gte(partyLedgerLines.entryDate, input.from) : undefined,
    input.to ? lte(partyLedgerLines.entryDate, input.to) : undefined,
  );
}

// Exposure lines oldest first: receivable claims increase the running balance;
// payable claims decrease it.
export async function partyStatement(
  orgId: string,
  input: { partyId: string; from?: string; to?: string },
  limit: number,
): Promise<PartyStatementReport> {
  const profile = await reportProfile(orgId);
  const to = input.to ?? businessDate(new Date(), profile.timeZone);
  const range: ReportHeader["range"] = input.from ? { from: input.from, to } : { asOf: to };

  // Read from `party_ledger_lines_org_party_date_idx` alone, in the statement's order.
  await assertReportFits(
    db
      .select({ id: partyLedgerLines.id })
      .from(partyLedgerLines)
      .where(partyStatementWhere(orgId, { ...input, to }))
      .orderBy(asc(partyLedgerLines.entryDate), asc(partyLedgerLines.id)),
    limit,
  );

  const [party, opening, rows] = await Promise.all([
    requireParty(orgId, input.partyId),
    input.from
      ? db
          .select({
            total: sql<bigint>`coalesce(sum(${partyLedgerLines.amountPaise}), 0)::bigint`.mapWith(
              BigInt,
            ),
          })
          .from(partyLedgerLines)
          .where(
            and(
              partyStatementWhere(orgId, { partyId: input.partyId }),
              lt(partyLedgerLines.entryDate, input.from),
            ),
          )
      : [{ total: 0n }],
    partyStatementRows(orgId, { ...input, to }, limit),
  ]);

  if (rows.length > limit) throw reportTooLarge(limit);

  const openingPaise = opening[0]?.total ?? 0n;
  let balancePaise = openingPaise;

  const lines = rows.map((row) => {
    balancePaise += row.amountPaise;

    return { ...row, typeLabel: documentLabel(row.documentType, row.side), balancePaise };
  });

  return {
    header: headerFromProfile(profile, range),
    party,
    openingPaise,
    lines,
    closingPaise: balancePaise,
  };
}

// One keyset page oldest first, without balances: pages load contiguously from
// page one, so the client runs the balance from `ledgerSummary.openingPaise`
// instead of the server summing every earlier line for each page.
async function partyLedgerPage(
  orgId: string,
  input: {
    partyId: string;
    from?: string;
    to?: string;
    cursor?: z.infer<typeof ledgerCursor>;
    limit: number;
  },
) {
  const profile = await reportProfile(orgId);
  const to = input.to ?? businessDate(new Date(), profile.timeZone);

  const [, detail] = await Promise.all([
    requireParty(orgId, input.partyId),
    partyStatementRows(orgId, { ...input, to }, input.limit),
  ]);

  const { rows, hasMore } = pageOf(detail, input.limit);

  return {
    rows: rows.map((row) => ({ ...row, typeLabel: documentLabel(row.documentType, row.side) })),
    hasMore,
  };
}

// The statement's figures without its lines: what the ledger toolbar, the party
// overview and the Transactions tab show. Debits are the positive exposure lines.
async function partyLedgerSummary(
  orgId: string,
  input: { partyId: string; from?: string; to?: string },
) {
  const profile = await reportProfile(orgId);
  const to = input.to ?? businessDate(new Date(), profile.timeZone);

  const amount = partyLedgerLines.amountPaise;
  const opening = input.from ? lt(partyLedgerLines.entryDate, input.from) : sql`false`;
  const inPeriod = input.from ? gte(partyLedgerLines.entryDate, input.from) : sql`true`;

  const [, [amounts]] = await Promise.all([
    requireParty(orgId, input.partyId),
    db
      .select({
        openingPaise:
          sql<bigint>`coalesce(sum(${amount}) filter (where ${opening}), 0)::bigint`.mapWith(
            BigInt,
          ),
        debitPaise:
          sql<bigint>`coalesce(sum(${amount}) filter (where ${amount} > 0 and ${inPeriod}), 0)::bigint`.mapWith(
            BigInt,
          ),
        creditPaise:
          sql<bigint>`coalesce(-sum(${amount}) filter (where ${amount} < 0 and ${inPeriod}), 0)::bigint`.mapWith(
            BigInt,
          ),
      })
      .from(partyLedgerLines)
      .where(
        and(
          eq(partyLedgerLines.orgId, orgId),
          eq(partyLedgerLines.partyId, input.partyId),
          lte(partyLedgerLines.entryDate, to),
        ),
      ),
  ]);

  if (!amounts) throw impossible("aggregate returned no row");
  const { openingPaise, debitPaise, creditPaise } = amounts;

  return {
    openingPaise,
    debitPaise,
    creditPaise,
    closingPaise: openingPaise + debitPaise - creditPaise,
  };
}

export const partyRouter = {
  create: orgProcedure(
    { party: ["create"] },
    orgInput
      .extend(partyInputFields)
      .extend({ allowNamesake: z.boolean().default(false) })
      .transform(deriveFromGstin),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { orgSlug: _claim, allowNamesake, ...partyFieldsInput } = input;

    const [created] = await db.transaction((tx) =>
      createParties(
        tx,
        scope.orgId,
        [{ ...partyFieldsInput, id: Bun.randomUUIDv7() }],
        allowNamesake,
      ),
    );

    if (!created) throw impossible("Party insert returned no row");

    return created;
  }),

  update: orgProcedure(
    { party: ["update"] },
    orgInput
      .extend({ partyId: z.uuid() })
      .extend(partyInputFields)
      .extend({
        active: z.boolean(),
        allowNamesake: z.boolean().default(false),
        updatedAt: editToken,
      })
      .transform(deriveFromGstin),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    const {
      orgSlug: _claim,
      partyId,
      active,
      allowNamesake,
      updatedAt,
      ...partyFieldsInput
    } = input;

    const values = partyValues(partyFieldsInput);

    const party = await db.transaction(async (tx) => {
      await claimParties(tx, scope.orgId, [values], allowNamesake, partyId);

      // One compare-and-swap: a missing row and a newer one both mean the editor's
      // copy is stale, so neither needs a second read to tell them apart.
      const [updated] = await tx
        .update(parties)
        .set({
          ...values,
          active,
          updatedAt: nextEditToken(parties.updatedAt),
        })
        .where(
          and(
            eq(parties.orgId, scope.orgId),
            eq(parties.id, partyId),
            eq(parties.updatedAt, new Date(updatedAt)),
          ),
        )
        .returning();

      if (!updated) {
        throw conflict("STALE_RECORD", "This party changed after you opened it.");
      }

      return updated;
    });

    return party;
  }),

  get: orgProcedure({ party: ["read"] }, orgInput.extend({ partyId: z.uuid() })).handler(
    async ({ context, input }) => {
      const [party] = await db
        .select()
        .from(parties)
        .where(and(eq(parties.orgId, context.scope.orgId), eq(parties.id, input.partyId)))
        .limit(1);

      if (!party) {
        throw new ORPCError("NOT_FOUND", { message: "Party not found." });
      }

      return party;
    },
  ),

  // Receivable pickers serve the Receipt form under `party:read`; the payable side
  // exposes Bills and Debit Notes, which an operator never reads.
  openItems: orgProcedure(
    { party: ["read"] },
    orgInput.extend({
      partyId: z.uuid(),
      side: z.enum(["receivable", "payable"]),
      type: z.literal("invoice").optional(),
      cursor: documentCursor.optional(),
      limit: pageLimit,
    }),
  ).handler(async ({ context, input }) => {
    if (input.side === "payable") requirePermission(context.scope, { bill: ["read"] });
    await requireParty(context.scope.orgId, input.partyId);

    return openItems(
      context.scope.orgId,
      input,
      authorize(context.scope.roles, { journal: ["read"] }),
    );
  }),

  openCredits: orgProcedure(
    { party: ["read"], note: ["read"] },
    orgInput.extend({
      partyId: z.uuid(),
      side: z.enum(["receivable", "payable"]),
      types: z
        .array(z.enum(["receipt", "creditNote", "payment", "debitNote", "journal"]))
        .min(1)
        .max(5)
        .optional(),
      tdsOnly: z.boolean().optional(),
      q: searchQuery,
      cursor: documentCursor.optional(),
      limit: pageLimit,
    }),
  ).handler(async ({ context, input }) => {
    if (input.side === "payable") requirePermission(context.scope, { bill: ["read"] });
    await requireParty(context.scope.orgId, input.partyId);

    return openCredits(context.scope.orgId, input);
  }),

  statement: orgProcedure(
    { party: ["read"], report: ["read"] },
    orgInput.extend({ partyId: z.uuid(), ...period }).superRefine(orderedPeriod),
  ).handler(({ context, input }) => partyStatement(context.scope.orgId, input, STATEMENT_LIMIT)),
  ledgerLines: orgProcedure(
    { party: ["read"], report: ["read"] },
    orgInput
      .extend({ partyId: z.uuid(), ...period, cursor: ledgerCursor.optional(), limit: pageLimit })
      .superRefine(orderedPeriod),
  ).handler(({ context, input }) => partyLedgerPage(context.scope.orgId, input)),

  ledgerSummary: orgProcedure(
    { party: ["read"], report: ["read"] },
    orgInput.extend({ partyId: z.uuid(), ...period }).superRefine(orderedPeriod),
  ).handler(({ context, input }) => partyLedgerSummary(context.scope.orgId, input)),

  // Every document naming the party, newest first, as Zoho's contact Transactions list
  // shows them: drafts, posted and cancelled, one keyset page at a time.
  transactions: orgProcedure(
    { party: ["read"] },
    orgInput
      .extend({ partyId: z.uuid(), cursor: z.uuid().optional(), limit: pageLimit, ...period })
      .superRefine(orderedPeriod),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    await requireParty(scope.orgId, input.partyId);

    const types = TRANSACTION_TYPES.filter((type) =>
      authorize(scope.roles, TRANSACTION_READS[type]),
    );

    if (types.length === 0) return { rows: [], hasMore: false };

    const rows = await db
      .select({
        id: documents.id,
        type: documents.type,
        number: documents.number,
        documentDate: documents.documentDate,
        state: documents.state,
        reference: documents.reference,
        exposureSide: documents.exposureSide,
        totalPaise: documents.totalPaise,
      })
      .from(documents)
      .where(
        and(
          eq(documents.orgId, scope.orgId),
          eq(documents.partyId, input.partyId),
          inArray(documents.type, types),
          input.cursor ? lt(documents.id, input.cursor) : undefined,
          documentPeriod(input),
        ),
      )
      .orderBy(desc(documents.id))
      .limit(input.limit + 1);

    return pageOf(
      // SAFETY: the query keeps only rows whose type is in `types`, a TransactionType list.
      rows.map((row) => ({ ...row, type: row.type as TransactionType })),
      input.limit,
    );
  }),

  // Home and party lists show each party's closing balance through today's business
  // date. Sparse: a party with no ledger line through today has no row.
  balances: orgProcedure({ party: ["read"], report: ["read"] }, orgInput).handler(
    async ({ context }) => {
      const { orgId } = context.scope;
      const profile = await reportProfile(orgId);
      const today = businessDate(new Date(), profile.timeZone);

      return db
        .select({
          partyId: partyLedgerLines.partyId,
          balancePaise: sql<bigint>`sum(${partyLedgerLines.amountPaise})::bigint`.mapWith(BigInt),
        })
        .from(partyLedgerLines)
        .where(and(eq(partyLedgerLines.orgId, orgId), lte(partyLedgerLines.entryDate, today)))
        .groupBy(partyLedgerLines.partyId);
    },
  ),

  // The master up to MASTER_LIST_LIMIT rows; every caller filters `active` in memory
  // from this one entry. Past the bound `hasMore` is true, and callers search with `q`
  // on name or GSTIN, so no party is unreachable. Only what the list, Link Field and
  // palette show: contact and address fields come from `get` when one party opens.
  list: orgProcedure({ party: ["read"] }, orgInput.extend({ q: searchQuery })).handler(
    async ({ context, input }) => {
      const pattern = input.q ? likePattern(input.q) : undefined;

      const rows = await db
        .select({
          id: parties.id,
          name: parties.name,
          roles: parties.roles,
          gstin: parties.gstin,
          active: parties.active,
        })
        .from(parties)
        .where(
          and(
            eq(parties.orgId, context.scope.orgId),
            pattern ? or(ilike(parties.name, pattern), ilike(parties.gstin, pattern)) : undefined,
          ),
        )
        .orderBy(asc(parties.name), asc(parties.id))
        .limit(MASTER_LIST_LIMIT + 1);

      return pageOf(rows, MASTER_LIST_LIMIT);
    },
  ),
};
