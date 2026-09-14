import { db } from "@accly/db";
import { ACCOUNT_TYPES, accounts } from "@accly/db/schema/accounts";
import { journalLines } from "@accly/db/schema/journal-lines";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, max, sql } from "drizzle-orm";
import { z } from "zod";

import { MONEY_KINDS } from "@accly/db/schema/money-kinds";
import { moneyGroup, underMoneyGroup } from "../lib/accounts";
import { badRequest } from "../lib/conflict";
import { uniqueViolationConstraint } from "../lib/db-errors";
import { capMasterList, MASTER_LIST_LIMIT } from "../lib/master-list";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { shortName } from "../lib/schemas";

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

  // A new cash box or bank account. Only money leaves are created here; the rest of the
  // chart comes from the template.
  create: orgProcedure(
    { account: ["create"] },
    orgInput.extend({ kind: z.enum(MONEY_KINDS), name: shortName.max(120) }),
  ).handler(async ({ context, input }) => {
    const { orgId } = context.scope;

    const [group] = await db
      .select({ id: accounts.id, code: accounts.code, type: accounts.type })
      .from(accounts)
      .where(and(eq(accounts.orgId, orgId), eq(accounts.systemKey, input.kind)))
      .limit(1);

    if (!group) throw new Error(`Organization ${orgId} is missing the ${input.kind} group`);

    // Codes follow the group: 1001, 1002 under Cash 1000.
    const [last] = await db
      .select({ code: max(accounts.code) })
      .from(accounts)
      .where(and(eq(accounts.orgId, orgId), eq(accounts.parentId, group.id)));

    const code = String(Number(last?.code ?? group.code) + 1);

    // Each group owns the 99 codes after its own; the next block belongs to another group.
    if (Number(code) > Number(group.code) + 99) {
      throw badRequest("ACCOUNT_CODES_FULL", "This group has no free account codes.");
    }

    try {
      const [created] = await db
        .insert(accounts)
        .values({
          id: Bun.randomUUIDv7(),
          orgId,
          parentId: group.id,
          code,
          name: input.name,
          type: group.type,
        })
        .returning();

      if (!created) throw new Error("Account insert returned no row");

      return created;
    } catch (error) {
      if (uniqueViolationConstraint(error) === "accounts_org_code_idx") {
        throw new ORPCError("CONFLICT", {
          message: "Another account took that code at the same moment. Try again.",
        });
      }

      throw error;
    }
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
