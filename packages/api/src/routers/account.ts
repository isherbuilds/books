import { db } from "@accly/db";
import {
  ACCOUNT_TYPES,
  accounts,
  SUPPLY_CLASSES,
  type AccountType,
} from "@accly/db/schema/accounts";
import { items } from "@accly/db/schema/items";
import { journalLines } from "@accly/db/schema/journal-lines";
import { MONEY_KINDS } from "@accly/db/schema/money-kinds";
import { paymentMethods } from "@accly/db/schema/payment-methods";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { isLeaf, moneyGroup, underMoneyGroup } from "../lib/accounts";
import { badRequest, conflict, impossible, nextEditToken } from "../lib/conflict";
import { uniqueViolationConstraint } from "../lib/db-errors";
import { capMasterList, MASTER_LIST_LIMIT } from "../lib/master-list";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { shortName } from "../lib/schemas";

// Templates own code 3000 and 6800–6999.
const ACCOUNT_CODE_RANGES: Record<AccountType, readonly [number, number]> = {
  asset: [1200, 1999],
  liability: [2000, 2999],
  equity: [3001, 3999],
  income: [5000, 5999],
  expense: [6000, 6799],
};

function accountNameTaken(error: unknown): never {
  if (uniqueViolationConstraint(error) === "accounts_org_active_name_idx") {
    throw conflict("ACCOUNT_NAME_TAKEN", "An account with this name already exists.");
  }

  throw error;
}

export const accountRouter = {
  list: orgProcedure(
    { account: ["read"] },
    orgInput.extend({
      type: z.enum(ACCOUNT_TYPES).optional(),
      activeOnly: z.boolean().optional(),
    }),
  ).handler(async ({ context, input }) => {
    const rows = await db
      .select()
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
  create: orgProcedure(
    { account: ["create"] },
    orgInput.extend({
      name: shortName.max(120),
      supplyClass: z.enum(SUPPLY_CLASSES).optional(),
      parent: z.union([
        z.object({ type: z.enum(ACCOUNT_TYPES) }),
        z.object({ accountId: z.uuid() }),
      ]),
    }),
  ).handler(async ({ context, input }) => {
    const { orgId } = context.scope;

    let parentId: string | null = null;
    let type: AccountType;
    let codeRange: readonly [number, number];

    if ("type" in input.parent) {
      type = input.parent.type;
      codeRange = ACCOUNT_CODE_RANGES[type];
    } else {
      const [parent] = await db
        .select({
          id: accounts.id,
          code: accounts.code,
          type: accounts.type,
          systemKey: accounts.systemKey,
          active: accounts.active,
          isLeaf: sql<boolean>`${isLeaf(orgId)}`,
        })
        .from(accounts)
        .where(and(eq(accounts.orgId, orgId), eq(accounts.id, input.parent.accountId)))
        .limit(1);

      if (!parent) throw new ORPCError("NOT_FOUND", { message: "Account not found." });

      if (!parent.active || parent.isLeaf) {
        throw badRequest("ACCOUNT_PARENT_INVALID", "Choose an active account group.");
      }

      parentId = parent.id;
      type = parent.type;
      codeRange = MONEY_KINDS.some((kind) => kind === parent.systemKey)
        ? [Number(parent.code) + 1, Number(parent.code) + 99]
        : ACCOUNT_CODE_RANGES[type];
    }

    if (type === "income" && input.supplyClass === undefined) {
      throw badRequest("SUPPLY_CLASS_REQUIRED", "Income accounts require a GST supply class.");
    }

    if (type !== "income" && input.supplyClass !== undefined) {
      throw badRequest(
        "SUPPLY_CLASS_NOT_ALLOWED",
        "Only income accounts may have a GST supply class.",
      );
    }

    const [rangeStart, rangeEnd] = codeRange;

    const [last] = await db
      .select({ code: sql<number | null>`max(cast(${accounts.code} as integer))` })
      .from(accounts)
      .where(
        and(
          eq(accounts.orgId, orgId),
          eq(accounts.type, type),
          sql`cast(${accounts.code} as integer) between ${rangeStart} and ${rangeEnd}`,
        ),
      );

    const nextCode = (last?.code ?? rangeStart - 1) + 1;

    if (nextCode > rangeEnd) {
      throw badRequest(
        "ACCOUNT_CODES_FULL",
        "This account type or group has no free account codes.",
      );
    }

    const code = String(nextCode);

    try {
      const [created] = await db
        .insert(accounts)
        .values({
          id: Bun.randomUUIDv7(),
          orgId,
          name: input.name,
          parentId,
          code,
          type,
          supplyClass: input.supplyClass ?? null,
        })
        .returning();

      if (!created) throw impossible("Account insert returned no row");

      return created;
    } catch (error) {
      if (uniqueViolationConstraint(error) === "accounts_org_code_idx") {
        throw new ORPCError("CONFLICT", {
          message: "Another account took that code at the same moment. Try again.",
        });
      }

      accountNameTaken(error);
    }
  }),

  update: orgProcedure(
    { account: ["update"] },
    orgInput.extend({
      accountId: z.uuid(),
      name: shortName.max(120),
      updatedAt: z.iso.datetime({ precision: 3 }),
    }),
  ).handler(async ({ context, input }) => {
    const { orgId } = context.scope;

    const [updated] = await db
      .update(accounts)
      .set({ name: input.name, updatedAt: nextEditToken(accounts.updatedAt) })
      .where(
        and(
          eq(accounts.orgId, orgId),
          eq(accounts.id, input.accountId),
          eq(accounts.updatedAt, new Date(input.updatedAt)),
        ),
      )
      .returning()
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
          throw badRequest("ACCOUNT_SYSTEM", "Groups and system accounts cannot be archived.");
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

  // Every cash box and bank account with its group and what it holds now, summed from
  // journal lines. Inactive leaves are included: they keep their balance.
  moneyBalances: orgProcedure({ report: ["readFinancial"] }, orgInput).handler(({ context }) => {
    const { orgId } = context.scope;

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
        and(eq(journalLines.orgId, orgId), eq(journalLines.accountId, accounts.id)),
      )
      .where(eq(accounts.orgId, orgId))
      .groupBy(accounts.id, moneyGroup.id)
      .orderBy(asc(moneyGroup.code), asc(accounts.code));
  }),
};
