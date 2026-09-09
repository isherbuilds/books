import { db } from "@accly/db";
import { ITEM_CATEGORIES, items, OPD_BILLABLE_CATEGORIES } from "@accly/db/schema/items";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { conflict } from "../lib/conflict";
import { uniqueViolationConstraint } from "../lib/db-errors";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { likePattern, money, pageLimit, searchQuery, shortName } from "../lib/schemas";

const itemFields = z.object({
  name: shortName,
  code: z.string().trim().min(1).max(20),
  category: z.enum(ITEM_CATEGORIES),
  unitPrice: money,
  taxRatePercent: z
    .string()
    .regex(/^\d{1,2}(\.\d{1,2})?$/)
    .default("0"),
  taxCode: z.string().trim().max(20).nullish(),
});

export const itemRouter = {
  // Consultations require an explicit opt-in from immediate intake or billing;
  // scheduled intake cannot surface them.
  searchServices: orgProcedure(
    { item: ["read"] },
    orgInput.extend({
      query: z.string().trim().max(100).optional(),
      includeConsultation: z.boolean(),
    }),
  ).handler(async ({ context, input }) => {
    const pattern = input.query ? likePattern(input.query) : undefined;
    return db
      .select({
        id: items.id,
        code: items.code,
        name: items.name,
        category: items.category,
        unitPrice: items.unitPrice,
        taxRatePercent: items.taxRatePercent,
      })
      .from(items)
      .where(
        and(
          eq(items.orgId, context.scope.orgId),
          eq(items.active, true),
          // `resolveOpdPricing` refuses the rest anyway; showing it would be an
          // invitation to fail.
          inArray(items.category, [...OPD_BILLABLE_CATEGORIES]),
          input.includeConsultation ? undefined : ne(items.category, "consultation"),
          pattern
            ? or(
                ilike(items.code, pattern),
                ilike(items.name, pattern),
                ilike(items.category, pattern),
              )
            : undefined,
        ),
      )
      .orderBy(asc(items.name), asc(items.id))
      .limit(6);
  }),

  list: orgProcedure(
    { item: ["read"] },
    orgInput.extend({
      query: searchQuery,
      category: z.enum(ITEM_CATEGORIES).optional(),
      activeOnly: z.boolean().default(false),
      // The keyset is (name, id) because the list orders by name and ids break ties.
      cursor: z.object({ name: z.string(), id: z.string() }).optional(),
      limit: pageLimit,
    }),
  ).handler(async ({ context, input }) => {
    const pattern = input.query ? likePattern(input.query) : undefined;
    const rows = await db
      .select()
      .from(items)
      .where(
        and(
          eq(items.orgId, context.scope.orgId),
          input.category ? eq(items.category, input.category) : undefined,
          input.activeOnly ? eq(items.active, true) : undefined,
          pattern ? or(ilike(items.code, pattern), ilike(items.name, pattern)) : undefined,
          input.cursor
            ? sql`(${items.name}, ${items.id}) > (${input.cursor.name}, ${input.cursor.id})`
            : undefined,
        ),
      )
      .orderBy(asc(items.name), asc(items.id))
      .limit(input.limit + 1);

    const hasNextPage = rows.length > input.limit;
    if (hasNextPage) {
      rows.pop();
    }
    const last = rows.at(-1);

    return {
      items: rows,
      nextCursor: hasNextPage && last ? { name: last.name, id: last.id } : null,
    };
  }),

  create: orgProcedure({ item: ["create"] }, orgInput.extend(itemFields.shape)).handler(
    async ({ context, input }) => {
      const { scope } = context;
      const { orgSlug: _claim, ...fields } = input;
      const id = Bun.randomUUIDv7();

      try {
        const [item] = await db
          .insert(items)
          .values({
            ...fields,
            id,
            orgId: scope.orgId,
            taxCode: fields.taxCode ?? null,
          })
          .returning();

        if (!item) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Failed to create item item",
          });
        }

        audit({
          action: "item.create",
          actorId: scope.userId,
          orgId: scope.orgId,
          target: `item:${id}`,
          // Origin entry of the price timeline; item.update meta carries every change after.
          meta: {
            unitPrice: item.unitPrice,
            taxRatePercent: item.taxRatePercent,
            active: item.active,
          },
        });

        return item;
      } catch (error) {
        if (uniqueViolationConstraint(error) !== undefined) {
          throw conflict("duplicate", "A item item with this code already exists.");
        }
        throw error;
      }
    },
  ),

  update: orgProcedure(
    { item: ["update"] },
    orgInput.extend({
      itemId: z.string(),
      ...itemFields.shape,
      active: z.boolean(),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { orgSlug: _claim, itemId, ...fields } = input;

    try {
      const [item] = await db
        .update(items)
        .set({
          ...fields,
          taxCode: fields.taxCode ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(items.orgId, scope.orgId), eq(items.id, itemId)))
        .returning();

      if (!item) {
        throw new ORPCError("NOT_FOUND", { message: "That item item no longer exists." });
      }

      audit({
        action: "item.update",
        actorId: scope.userId,
        orgId: scope.orgId,
        target: `item:${itemId}`,
        // Written values make the audit trail double as the price-change history, so
        // successive entries reconstruct the timeline without a dedicated table.
        meta: {
          unitPrice: item.unitPrice,
          taxRatePercent: item.taxRatePercent,
          active: item.active,
        },
      });

      return item;
    } catch (error) {
      if (uniqueViolationConstraint(error) !== undefined) {
        throw conflict("duplicate", "A item item with this code already exists.");
      }
      throw error;
    }
  }),
};
