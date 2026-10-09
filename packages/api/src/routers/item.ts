import { db } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { items } from "@accly/db/schema/items";
import { taxRates } from "@accly/db/schema/tax-rates";
import { ORPCError } from "@orpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { createItems, itemFields, itemNameTaken, itemValues } from "../core/masters";
import { effectiveOn } from "../core/tax-schedule";
import { businessDate } from "../lib/business-date";
import { impossible, nextEditToken } from "../lib/conflict";
import { capMasterList, MASTER_LIST_LIMIT } from "../lib/master-list";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { dateOnly, editToken } from "../lib/schemas";
import { orgTimeZone } from "../lib/org-settings";

export const itemRouter = {
  // The complete master; every caller filters `active` in memory from this one entry.
  list: orgProcedure({ item: ["read"] }, orgInput).handler(async ({ context }) => {
    const { orgId } = context.scope;

    const rows = await db
      .select({
        id: items.id,
        name: items.name,
        hsnSac: items.hsnSac,
        unit: items.unit,
        unitPricePaise: items.unitPricePaise,
        mrpPaise: items.mrpPaise,
        incomeAccountId: items.incomeAccountId,
        incomeAccountName: accounts.name,
        taxCode: items.taxCode,
        active: items.active,
        updatedAt: items.updatedAt,
      })
      .from(items)
      .innerJoin(accounts, and(eq(accounts.orgId, orgId), eq(accounts.id, items.incomeAccountId)))
      .where(eq(items.orgId, orgId))
      .orderBy(asc(items.name), asc(items.id))
      .limit(MASTER_LIST_LIMIT + 1);

    return capMasterList(rows);
  }),

  create: orgProcedure({ item: ["create"] }, orgInput.extend(itemFields)).handler(
    async ({ context, input }) => {
      const { orgSlug: _claim, ...fields } = input;
      const today = businessDate(new Date(), await orgTimeZone(context.scope.orgId));

      const [created] = await db.transaction((tx) =>
        createItems(tx, context.scope.orgId, [{ ...fields, id: Bun.randomUUIDv7() }], today),
      );

      if (!created) throw impossible("Item insert returned no row");

      return created;
    },
  ),

  update: orgProcedure(
    { item: ["update"] },
    orgInput.extend({
      itemId: z.uuid(),
      updatedAt: editToken,
      ...itemFields,
    }),
  ).handler(async ({ context, input }) => {
    const { orgSlug: _claim, itemId, updatedAt, ...fields } = input;
    const today = businessDate(new Date(), await orgTimeZone(context.scope.orgId));

    return db
      .transaction(async (tx) => {
        const [values] = await itemValues(tx, context.scope.orgId, [fields], today);

        if (!values) throw impossible("Validated item has no values");

        const [updated] = await tx
          .update(items)
          .set({ ...values, updatedAt: nextEditToken(items.updatedAt) })
          .where(
            and(
              eq(items.orgId, context.scope.orgId),
              eq(items.id, itemId),
              eq(items.updatedAt, new Date(updatedAt)),
            ),
          )
          .returning();

        if (!updated) {
          throw new ORPCError("CONFLICT", { message: "This item changed after you opened it." });
        }

        return updated;
      })
      .catch(itemNameTaken);
  }),

  // Separate from update so marking inactive skips itemValues: restoring must not check
  // the income account, and an Item on an ended tax code must still be able to leave.
  setActive: orgProcedure(
    { item: ["update"] },
    orgInput.extend({
      itemId: z.uuid(),
      updatedAt: editToken,
      active: z.boolean(),
    }),
  ).handler(async ({ context, input }) => {
    const [updated] = await db
      .update(items)
      .set({ active: input.active, updatedAt: nextEditToken(items.updatedAt) })
      .where(
        and(
          eq(items.orgId, context.scope.orgId),
          eq(items.id, input.itemId),
          eq(items.updatedAt, new Date(input.updatedAt)),
        ),
      )
      .returning();

    if (!updated) {
      throw new ORPCError("CONFLICT", { message: "This item changed after you opened it." });
    }

    return updated;
  }),

  // The rates an Item may take today; an Invoice resolves its own date's rate at post.
  taxRates: orgProcedure(
    { item: ["read"] },
    orgInput.extend({ date: dateOnly.optional() }),
  ).handler(async ({ context, input }) => {
    const { orgId } = context.scope;
    const date = input.date ?? businessDate(new Date(), await orgTimeZone(orgId));

    return db
      .select({ id: taxRates.id, code: taxRates.code, name: taxRates.name })
      .from(taxRates)
      .where(and(eq(taxRates.orgId, orgId), effectiveOn(taxRates, date)))
      .orderBy(asc(taxRates.rateBasisPoints), asc(taxRates.code));
  }),
};
