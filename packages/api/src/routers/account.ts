import { db } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { ACCOUNT_TYPES, SUPPLY_CLASSES } from "@accly/db/schema/account-kinds";
import { items } from "@accly/db/schema/items";
import { journalLines } from "@accly/db/schema/journal-lines";
import { paymentMethods } from "@accly/db/schema/payment-methods";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, isNotNull, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { audit } from "@accly/db/audit";
import {
  accountCreateFields,
  accountNameTaken,
  accountSupplyError,
  createAccounts,
} from "../core/masters";
import { isLeaf, moneyGroup, underMoneyGroup } from "../lib/accounts";
import { businessDate } from "../lib/business-date";
import { badRequest, conflict, impossible, nextEditToken } from "../lib/conflict";
import { capMasterList, MASTER_LIST_LIMIT } from "../lib/master-list";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { reportProfile } from "../lib/reports";
import { editToken, shortName } from "../lib/schemas";

export const accountRouter = {
  list: orgProcedure(
    { account: ["read"] },
    orgInput.extend({
      type: z.enum(ACCOUNT_TYPES).optional(),
      activeOnly: z.boolean().optional(),
    }),
  ).handler(async ({ context, input }) => {
    const rows = await db
      .select({
        id: accounts.id,
        parentId: accounts.parentId,
        code: accounts.code,
        name: accounts.name,
        type: accounts.type,
        systemKey: accounts.systemKey,
        supplyClass: accounts.supplyClass,
        active: accounts.active,
        // The edit token: an update carries it back.
        updatedAt: accounts.updatedAt,
      })
      .from(accounts)
      .where(
        and(
          eq(accounts.orgId, context.scope.orgId),
          input.type ? eq(accounts.type, input.type) : undefined,
          input.activeOnly ? eq(accounts.active, true) : undefined,
        ),
      )
      .orderBy(asc(accounts.code), asc(accounts.id))
      .limit(MASTER_LIST_LIMIT + 1);

    return capMasterList(rows);
  }),

  // A new posting account, either at the root of its type or under an existing group.
  create: orgProcedure({ account: ["create"] }, orgInput.extend(accountCreateFields)).handler(
    async ({ context, input }) => {
      const { orgId } = context.scope;

      const { name, supplyClass, parent } = input;

      const [created] = await db.transaction((tx) =>
        createAccounts(tx, orgId, [{ id: Bun.randomUUIDv7(), name, supplyClass, parent }]),
      );

      if (!created) throw impossible("Account insert returned no row");

      return created;
    },
  ),

  update: orgProcedure(
    { account: ["update"] },
    orgInput.extend({
      accountId: z.uuid(),
      name: shortName.max(120),
      supplyClass: z.enum(SUPPLY_CLASSES).optional(),
      updatedAt: editToken,
    }),
  ).handler(async ({ context, input }) => {
    const { orgId } = context.scope;

    const updated = await db
      .transaction(async (tx) => {
        if (input.supplyClass !== undefined) {
          const [account] = await tx
            .select({ type: accounts.type, supplyClass: accounts.supplyClass })
            .from(accounts)
            .where(
              and(
                eq(accounts.orgId, orgId),
                eq(accounts.id, input.accountId),
                eq(accounts.updatedAt, new Date(input.updatedAt)),
              ),
            )
            .for("update");

          if (!account) {
            throw conflict("STALE_RECORD", "This account changed after you opened it.");
          }

          const supplyError = accountSupplyError(account.type, input.supplyClass);

          if (supplyError) throw badRequest(supplyError.code, supplyError.message);

          if (input.supplyClass !== account.supplyClass) {
            // Posting holds a shared account lock; check its lines after taking this lock.
            const [used] = await tx
              .select({ id: journalLines.id })
              .from(journalLines)
              .where(
                and(eq(journalLines.orgId, orgId), eq(journalLines.accountId, input.accountId)),
              )
              .limit(1);

            if (used) {
              throw badRequest(
                "ACCOUNT_IN_USE",
                "An account with posted journal lines cannot change its GST supply class.",
              );
            }

            // Only a taxable item carries a GST rate (`itemEligibilityError`).
            if (input.supplyClass !== "taxable")
              await tx
                .update(items)
                .set({ taxCode: null, updatedAt: nextEditToken(items.updatedAt) })
                .where(
                  and(
                    eq(items.orgId, orgId),
                    eq(items.incomeAccountId, input.accountId),
                    isNotNull(items.taxCode),
                  ),
                );
          }
        }

        const [row] = await tx
          .update(accounts)
          .set({
            name: input.name,
            supplyClass: input.supplyClass,
            updatedAt: nextEditToken(accounts.updatedAt),
          })
          .where(
            and(
              eq(accounts.orgId, orgId),
              eq(accounts.id, input.accountId),
              eq(accounts.updatedAt, new Date(input.updatedAt)),
            ),
          )
          .returning();

        return row;
      })
      .catch(accountNameTaken);

    if (!updated) {
      throw conflict("STALE_RECORD", "This account changed after you opened it.");
    }

    return updated;
  }),

  setActive: orgProcedure(
    { account: ["update"] },
    orgInput.extend({ accountId: z.uuid(), active: z.boolean() }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { orgId } = scope;

    const updated = await db
      .transaction(async (tx) => {
        const [account] = await tx
          .select({ systemKey: accounts.systemKey, isLeaf: sql<boolean>`${isLeaf(orgId)}` })
          .from(accounts)
          .where(and(eq(accounts.orgId, orgId), eq(accounts.id, input.accountId)))
          .for("update");

        if (!account) throw new ORPCError("NOT_FOUND", { message: "Account not found." });

        if (!account.isLeaf || account.systemKey) {
          throw badRequest(
            "ACCOUNT_SYSTEM",
            "Groups and system accounts cannot be marked inactive.",
          );
        }

        if (!input.active) {
          // Only income leaves take Items and only money leaves take Payment Methods,
          // so the other lookup finds nothing.
          const [item] = await tx
            .select({ name: items.name })
            .from(items)
            .where(
              and(
                eq(items.orgId, orgId),
                eq(items.incomeAccountId, input.accountId),
                eq(items.active, true),
              ),
            )
            .limit(1);

          if (item) {
            throw badRequest(
              "ACCOUNT_IN_USE",
              `This account is used by the active Item "${item.name}".`,
            );
          }

          const [method] = await tx
            .select({ name: paymentMethods.name })
            .from(paymentMethods)
            .where(
              and(
                eq(paymentMethods.orgId, orgId),
                eq(paymentMethods.accountId, input.accountId),
                eq(paymentMethods.active, true),
              ),
            )
            .limit(1);

          if (method) {
            throw badRequest(
              "ACCOUNT_IN_USE",
              `This account is used by the active Payment Method "${method.name}".`,
            );
          }
        }

        const [row] = await tx
          .update(accounts)
          .set({ active: input.active, updatedAt: nextEditToken(accounts.updatedAt) })
          .where(and(eq(accounts.orgId, orgId), eq(accounts.id, input.accountId)))
          .returning();

        if (!row) throw impossible("Account update returned no row");

        return row;
      })
      .catch(accountNameTaken);

    audit({
      action: "account.setActive",
      actorId: scope.userId,
      orgId,
      target: `account:${updated.id}`,
      meta: { active: input.active },
    });

    return updated;
  }),

  // Cash and bank balances through today's business date, as on the balance sheet.
  // Inactive leaves are included: they keep their balance.
  moneyBalances: orgProcedure({ report: ["readFinancial"] }, orgInput).handler(
    async ({ context }) => {
      const { orgId } = context.scope;
      const profile = await reportProfile(orgId);
      const today = businessDate(new Date(), profile.timeZone);

      return db
        .select({
          id: accounts.id,
          code: accounts.code,
          name: accounts.name,
          active: accounts.active,
          groupId: moneyGroup.id,
          groupName: moneyGroup.name,
          balancePaise:
            sql<bigint>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)::bigint`.mapWith(
              BigInt,
            ),
        })
        .from(accounts)
        .innerJoin(moneyGroup, underMoneyGroup(orgId))
        .leftJoin(
          journalLines,
          and(
            eq(journalLines.orgId, orgId),
            eq(journalLines.accountId, accounts.id),
            lte(journalLines.entryDate, today),
          ),
        )
        .where(eq(accounts.orgId, orgId))
        .groupBy(accounts.id, moneyGroup.id)
        .orderBy(asc(moneyGroup.code), asc(accounts.code));
    },
  ),
};
