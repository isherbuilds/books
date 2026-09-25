import { db } from "@accly/db";
import type { DbTransaction } from "@accly/db";
import { documents } from "@accly/db/schema/documents";
import { PARTY_ROLES, parties } from "@accly/db/schema/parties";
import { partyLedgerLines } from "@accly/db/schema/party-ledger-lines";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, gte, ilike, lt, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import { conflict, nextEditToken } from "../lib/conflict";
import { MASTER_LIST_LIMIT } from "../lib/master-list";
import { normalizedName } from "../lib/normalized-name";
import { orgInput, orgProcedure, requirePermission } from "../lib/procedures/factory";
import { openCredits, openItems, pageOf } from "../lib/settlements";
import {
  indianPinCode,
  indianStateCode,
  likePattern,
  masterName,
  optionalGstin,
  optionalPan,
  orderedPeriod,
  period,
  searchQuery,
  validateGstinIdentity,
} from "../lib/schemas";

const partyInputFields = {
  name: masterName,
  roles: z
    .array(z.enum(PARTY_ROLES))
    .min(1)
    .refine((roles) => new Set(roles).size === roles.length, "Party roles must be unique"),
  gstin: optionalGstin,
  pan: optionalPan,
  stateCode: indianStateCode,
  addressLine1: z.string().trim().min(1).max(200).optional(),
  addressLine2: z.string().trim().min(1).max(200).optional(),
  city: z.string().trim().min(1).max(120).optional(),
  pinCode: indianPinCode.optional(),
  email: z.email().optional(),
  phone: z.string().trim().min(1).max(30).optional(),
};

type PartyFields = z.infer<z.ZodObject<typeof partyInputFields>>;

export type PartyRecord = typeof parties.$inferSelect;

const STATEMENT_LIMIT = 5000;

const STATEMENT_TYPE_LABELS = {
  receipt: "Receipt",
  payment: "Payment",
  invoice: "Invoice",
  bill: "Bill",
  creditNote: "Credit Note",
  debitNote: "Debit Note",
  journal: "Journal",
  openingBalance: "Opening Balance",
} as const;

async function requireParty(orgId: string, partyId: string): Promise<void> {
  const [party] = await db
    .select({ id: parties.id })
    .from(parties)
    .where(and(eq(parties.orgId, orgId), eq(parties.id, partyId)))
    .limit(1);

  if (!party) throw new ORPCError("NOT_FOUND", { message: "Party not found." });
}

function partyValues(fields: PartyFields) {
  return {
    ...fields,
    normalizedName: normalizedName(fields.name),
    gstin: fields.gstin ?? null,
    pan: fields.pan ?? null,
    addressLine1: fields.addressLine1 ?? null,
    addressLine2: fields.addressLine2 ?? null,
    city: fields.city ?? null,
    pinCode: fields.pinCode ?? null,
    email: fields.email ?? null,
    phone: fields.phone ?? null,
  };
}

// Serializes writers of one normalized name, then refuses a namesake unless the caller
// confirmed it; the candidates let the client offer the existing Party instead.
async function claimPartyName(
  tx: DbTransaction,
  orgId: string,
  normalizedName: string,
  allowNamesake: boolean,
  exceptId?: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${orgId} || ':party:' || ${normalizedName}))`,
  );

  const namesakes = await tx
    .select({ id: parties.id })
    .from(parties)
    .where(
      and(
        eq(parties.orgId, orgId),
        eq(parties.normalizedName, normalizedName),
        exceptId ? ne(parties.id, exceptId) : undefined,
      ),
    );

  if (namesakes.length > 0 && !allowNamesake) {
    throw new ORPCError("CONFLICT", {
      message: "A party with this name already exists.",
      data: { reason: "PARTY_NAME_COLLISION", candidateIds: namesakes.map(({ id }) => id) },
    });
  }
}

// One Party per GSTIN is an application rule, not a unique index, so it can follow GST
// practice. The lock serializes writers of one GSTIN; names are always claimed first.
async function claimGstin(
  tx: DbTransaction,
  orgId: string,
  gstin: string | null,
  exceptId?: string,
): Promise<void> {
  if (!gstin) return;

  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId} || ':gstin:' || ${gstin}))`);

  const [taken] = await tx
    .select({ id: parties.id })
    .from(parties)
    .where(
      and(
        eq(parties.orgId, orgId),
        eq(parties.gstin, gstin),
        exceptId ? ne(parties.id, exceptId) : undefined,
      ),
    )
    .limit(1);

  if (taken) throw conflict("PARTY_GSTIN_TAKEN", "A party with this GSTIN already exists.");
}

export const partyRouter = {
  create: orgProcedure(
    { party: ["create"] },
    orgInput
      .extend(partyInputFields)
      .extend({ allowNamesake: z.boolean().default(false) })
      .superRefine(validateGstinIdentity),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { orgSlug: _claim, allowNamesake, ...partyFieldsInput } = input;
    const values = partyValues(partyFieldsInput);

    const party = await db.transaction(async (tx) => {
      await claimPartyName(tx, scope.orgId, values.normalizedName, allowNamesake);
      await claimGstin(tx, scope.orgId, values.gstin);

      const [created] = await tx
        .insert(parties)
        .values({ ...values, id: Bun.randomUUIDv7(), orgId: scope.orgId })
        .returning();

      if (!created) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to create party." });
      }

      return created;
    });

    return party;
  }),

  update: orgProcedure(
    { party: ["update"] },
    orgInput
      .extend({ partyId: z.uuid() })
      .extend(partyInputFields)
      .extend({
        active: z.boolean(),
        allowNamesake: z.boolean().default(false),
        // The `updatedAt` the editor loaded; a newer row means someone saved first.
        updatedAt: z.iso.datetime({ precision: 3 }),
      })
      .superRefine(validateGstinIdentity),
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
      await claimPartyName(tx, scope.orgId, values.normalizedName, allowNamesake, partyId);
      await claimGstin(tx, scope.orgId, values.gstin, partyId);

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
    orgInput.extend({ partyId: z.uuid(), side: z.enum(["receivable", "payable"]) }),
  ).handler(async ({ context, input }) => {
    if (input.side === "payable") requirePermission(context.scope, { bill: ["read"] });
    await requireParty(context.scope.orgId, input.partyId);

    return openItems(context.scope.orgId, input);
  }),

  openCredits: orgProcedure(
    { party: ["read"], note: ["read"] },
    orgInput.extend({
      partyId: z.uuid(),
      side: z.enum(["receivable", "payable"]),
      type: z.enum(["receipt", "creditNote", "payment", "debitNote"]).optional(),
    }),
  ).handler(async ({ context, input }) => {
    if (input.side === "payable") requirePermission(context.scope, { bill: ["read"] });
    await requireParty(context.scope.orgId, input.partyId);

    return openCredits(context.scope.orgId, input);
  }),

  // The party's statement of account, a Billing report (accounting-core call 15): its
  // exposure lines oldest first with a running balance. Receivable claims increase
  // the balance; payable claims decrease it. The statement combines both sides.
  statement: orgProcedure(
    { party: ["read"], report: ["read"] },
    orgInput.extend({ partyId: z.uuid(), ...period }).superRefine(orderedPeriod),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    await requireParty(scope.orgId, input.partyId);

    const partyLines = and(
      eq(partyLedgerLines.orgId, scope.orgId),
      eq(partyLedgerLines.partyId, input.partyId),
    );

    const [opening, rows] = await Promise.all([
      input.from
        ? db
            .select({
              total: sql<bigint>`coalesce(sum(${partyLedgerLines.amountPaise}), 0)::bigint`.mapWith(
                BigInt,
              ),
            })
            .from(partyLedgerLines)
            .where(and(partyLines, lt(partyLedgerLines.entryDate, input.from)))
        : [{ total: 0n }],
      db
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
        })
        .from(partyLedgerLines)
        .innerJoin(
          documents,
          and(eq(documents.orgId, scope.orgId), eq(documents.id, partyLedgerLines.documentId)),
        )
        .where(
          and(
            partyLines,
            input.from ? gte(partyLedgerLines.entryDate, input.from) : undefined,
            input.to ? lte(partyLedgerLines.entryDate, input.to) : undefined,
          ),
        )
        .orderBy(asc(partyLedgerLines.entryDate), asc(partyLedgerLines.id))
        .limit(STATEMENT_LIMIT + 1),
    ]);

    if (rows.length > STATEMENT_LIMIT) {
      throw new ORPCError("BAD_REQUEST", {
        message: "This statement exceeds 5,000 lines; choose a shorter period.",
      });
    }

    const openingPaise = opening[0]?.total ?? 0n;
    let balancePaise = openingPaise;

    const lines = rows.map((row) => {
      balancePaise += row.amountPaise;

      return { ...row, typeLabel: STATEMENT_TYPE_LABELS[row.documentType], balancePaise };
    });

    return { openingPaise, lines, closingPaise: balancePaise };
  }),

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
