import { db } from "@accly/db";
import type { DbTransaction } from "@accly/db/counter";
import { PARTY_ROLES, parties } from "@accly/db/schema/parties";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { conflict } from "../lib/conflict";
import { uniqueViolationConstraint } from "../lib/db-errors";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import {
  indianPinCode,
  indianStateCode,
  optionalGstin,
  optionalPan,
  shortName,
  validateGstinIdentity,
} from "../lib/schemas";

function normalizedPartyName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]/gu, "");
}

const partyInputFields = {
  name: shortName
    .max(120)
    .refine((name) => normalizedPartyName(name).length > 0, "Name must include a letter or number"),
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

const partyFields = z.object(partyInputFields).superRefine(validateGstinIdentity);

type PartyFields = z.infer<typeof partyFields>;

const MASTER_LIST_LIMIT = 5000;

function partyValues(fields: PartyFields) {
  return {
    ...fields,
    normalizedName: normalizedPartyName(fields.name),
    gstin: fields.gstin?.toUpperCase() ?? null,
    pan: fields.pan ?? null,
    addressLine1: fields.addressLine1 ?? null,
    addressLine2: fields.addressLine2 ?? null,
    city: fields.city ?? null,
    pinCode: fields.pinCode ?? null,
    email: fields.email ?? null,
    phone: fields.phone ?? null,
  };
}

async function lockPartyName(
  tx: DbTransaction,
  orgId: string,
  normalizedName: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${orgId} || ':party:' || ${normalizedName}))`,
  );
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
      await lockPartyName(tx, scope.orgId, values.normalizedName);

      const namesakes = await tx
        .select({ id: parties.id })
        .from(parties)
        .where(
          and(eq(parties.orgId, scope.orgId), eq(parties.normalizedName, values.normalizedName)),
        );

      if (namesakes.length > 0 && !allowNamesake) {
        throw new ORPCError("CONFLICT", {
          message: "A party with this name already exists.",
          data: {
            reason: "PARTY_NAME_COLLISION",
            candidateIds: namesakes.map(({ id: candidateId }) => candidateId),
          },
        });
      }

      try {
        const [created] = await tx
          .insert(parties)
          .values({
            ...values,
            id: Bun.randomUUIDv7(),
            orgId: scope.orgId,
          })
          .returning();

        if (!created) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Failed to create party.",
          });
        }

        return created;
      } catch (error) {
        if (uniqueViolationConstraint(error) === "parties_org_gstin_idx") {
          throw conflict("PARTY_GSTIN_TAKEN", "A party with this GSTIN already exists.");
        }

        throw error;
      }
    });

    return party;
  }),

  update: orgProcedure(
    { party: ["update"] },
    orgInput
      .extend({ partyId: z.string().uuid() })
      .extend(partyInputFields)
      .extend({ active: z.boolean(), allowNamesake: z.boolean().default(false) })
      .superRefine(validateGstinIdentity),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { orgSlug: _claim, partyId, active, allowNamesake, ...partyFieldsInput } = input;
    const values = partyValues(partyFieldsInput);

    const party = await db.transaction(async (tx) => {
      await lockPartyName(tx, scope.orgId, values.normalizedName);

      const namesakes = await tx
        .select({ id: parties.id })
        .from(parties)
        .where(
          and(
            eq(parties.orgId, scope.orgId),
            eq(parties.normalizedName, values.normalizedName),
            ne(parties.id, partyId),
          ),
        );

      if (namesakes.length > 0 && !allowNamesake) {
        throw new ORPCError("CONFLICT", {
          message: "A party with this name already exists.",
          data: {
            reason: "PARTY_NAME_COLLISION",
            candidateIds: namesakes.map(({ id: candidateId }) => candidateId),
          },
        });
      }

      try {
        const [updated] = await tx
          .update(parties)
          .set({ ...values, active, updatedAt: new Date() })
          .where(and(eq(parties.orgId, scope.orgId), eq(parties.id, partyId)))
          .returning();

        if (!updated) {
          throw new ORPCError("NOT_FOUND", { message: "Party not found." });
        }

        return updated;
      } catch (error) {
        if (uniqueViolationConstraint(error) === "parties_org_gstin_idx") {
          throw conflict("PARTY_GSTIN_TAKEN", "A party with this GSTIN already exists.");
        }

        throw error;
      }
    });

    return party;
  }),

  get: orgProcedure({ party: ["read"] }, orgInput.extend({ partyId: z.string().uuid() })).handler(
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

  list: orgProcedure(
    { party: ["read"] },
    orgInput.extend({ activeOnly: z.boolean().optional() }),
  ).handler(async ({ context, input }) => {
    const rows = await db
      .select()
      .from(parties)
      .where(
        input.activeOnly
          ? and(eq(parties.orgId, context.scope.orgId), eq(parties.active, true))
          : eq(parties.orgId, context.scope.orgId),
      )
      .orderBy(asc(parties.name), asc(parties.id))
      .limit(MASTER_LIST_LIMIT + 1);

    if (rows.length > MASTER_LIST_LIMIT) {
      throw new ORPCError("BAD_REQUEST", {
        message: "This list exceeds 5,000 rows.",
        data: { reason: "MASTER_LIST_LIMIT" },
      });
    }

    return rows;
  }),
};
