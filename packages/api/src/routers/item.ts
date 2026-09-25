import { db, type DbTransaction } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { items } from "@accly/db/schema/items";
import { taxRates } from "@accly/db/schema/tax-rates";
import { ORPCError } from "@orpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { effectiveOn } from "../core/tax-schedule";
import { postableAccounts } from "../lib/accounts";
import { businessDate } from "../lib/business-date";
import { badRequest, conflict, impossible, nextEditToken } from "../lib/conflict";
import { uniqueViolationConstraint } from "../lib/db-errors";
import { capMasterList, MASTER_LIST_LIMIT } from "../lib/master-list";
import { normalizedName } from "../lib/normalized-name";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { dateOnly, masterName, money, optionalHsnSac, optionalTaxCode } from "../lib/schemas";
import { orgTimeZone } from "../lib/settlements";

const optionalUnit = z.string().trim().min(1).max(20).optional();

const itemFields = {
  name: masterName,
  hsnSac: optionalHsnSac,
  unit: optionalUnit,
  unitPrice: money,
  incomeAccountId: z.uuid(),
  taxCode: optionalTaxCode,
};

type ItemFields = z.output<z.ZodObject<typeof itemFields>>;

async function itemValues(tx: DbTransaction, orgId: string, fields: ItemFields, today: string) {
  // The rate must be effective today, exactly as `item.taxRates` offers it: a code whose
  // range has ended cannot be resolved by a new invoice either.
  const taxRate = fields.taxCode
    ? await tx
        .select({ id: taxRates.id })
        .from(taxRates)
        .where(
          and(
            eq(taxRates.orgId, orgId),
            eq(taxRates.code, fields.taxCode),
            effectiveOn(taxRates, today),
          ),
        )
        .limit(1)
        .then(([row]) => row)
    : undefined;

  const [incomeAccount] = await postableAccounts(
    tx,
    orgId,
    [fields.incomeAccountId],
    ["income"],
  ).for("share", { of: accounts });

  if (!incomeAccount) {
    throw badRequest(
      "INCOME_ACCOUNT_INVALID",
      "Choose an active income account that is not a group or system account.",
    );
  }

  if (incomeAccount.supplyClass === "taxable" && !fields.taxCode) {
    throw badRequest("TAX_CODE_REQUIRED", "Choose a GST rate for a taxable item.");
  }

  if (incomeAccount.supplyClass !== "taxable" && fields.taxCode) {
    throw badRequest("TAX_CODE_NOT_ALLOWED", "Only taxable items may have a GST rate.");
  }

  if (fields.taxCode && !taxRate) {
    throw badRequest("TAX_CODE_INVALID", "Choose a GST rate effective in this organization.");
  }

  return {
    name: fields.name,
    normalizedName: normalizedName(fields.name),
    hsnSac: fields.hsnSac ?? null,
    unit: fields.unit ?? null,
    unitPricePaise: fields.unitPrice,
    incomeAccountId: incomeAccount.id,
    taxCode: fields.taxCode ?? null,
  };
}

function itemNameTaken(error: unknown): never {
  if (uniqueViolationConstraint(error) === "items_org_normalized_name_idx") {
    throw conflict("ITEM_NAME_TAKEN", "An item with that name already exists.");
  }

  throw error;
}

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

      return db
        .transaction(async (tx) => {
          const values = await itemValues(tx, context.scope.orgId, fields, today);

          const [created] = await tx
            .insert(items)
            .values({ id: Bun.randomUUIDv7(), orgId: context.scope.orgId, ...values })
            .returning();

          if (!created) throw impossible("Item insert returned no row");

          return created;
        })
        .catch(itemNameTaken);
    },
  ),

  update: orgProcedure(
    { item: ["update"] },
    orgInput.extend({
      itemId: z.uuid(),
      updatedAt: z.iso.datetime({ precision: 3 }),
      ...itemFields,
    }),
  ).handler(async ({ context, input }) => {
    const { orgSlug: _claim, itemId, updatedAt, ...fields } = input;
    const today = businessDate(new Date(), await orgTimeZone(context.scope.orgId));

    return db
      .transaction(async (tx) => {
        const values = await itemValues(tx, context.scope.orgId, fields, today);

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
      updatedAt: z.iso.datetime({ precision: 3 }),
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
