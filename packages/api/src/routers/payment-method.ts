import { db, type DbTransaction } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { paymentMethods } from "@accly/db/schema/payment-methods";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, getTableColumns } from "drizzle-orm";
import { z } from "zod";

import { isLeaf, moneyGroup, underMoneyGroup } from "../lib/accounts";
import { badRequest, conflict, impossible } from "../lib/conflict";
import { uniqueViolationConstraint } from "../lib/db-errors";
import { capMasterList, MASTER_LIST_LIMIT } from "../lib/master-list";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { shortName } from "../lib/schemas";

/** Share-locks an active cash or bank leaf so it cannot be archived before the write commits. */
async function lockMoneyAccount(tx: DbTransaction, orgId: string, accountId: string) {
  const [account] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .innerJoin(moneyGroup, underMoneyGroup(orgId))
    .where(
      and(
        eq(accounts.orgId, orgId),
        eq(accounts.id, accountId),
        eq(accounts.active, true),
        isLeaf(orgId),
      ),
    )
    .limit(1)
    .for("share", { of: accounts });

  if (!account) {
    throw badRequest("ACCOUNT_NOT_MONEY", "Choose an active cash or bank account.");
  }
}

export const paymentMethodRouter = {
  list: orgProcedure({ paymentMethod: ["read"] }, orgInput).handler(async ({ context }) => {
    const { orgId } = context.scope;

    const rows = await db
      .select({
        ...getTableColumns(paymentMethods),
        accountName: accounts.name,
        accountActive: accounts.active,
      })
      .from(paymentMethods)
      .innerJoin(
        accounts,
        and(eq(accounts.orgId, orgId), eq(accounts.id, paymentMethods.accountId)),
      )
      .where(eq(paymentMethods.orgId, orgId))
      .orderBy(asc(paymentMethods.name), asc(paymentMethods.id))
      .limit(MASTER_LIST_LIMIT + 1);

    return capMasterList(rows);
  }),

  // A method names where the money lands: an active cash box or bank account.
  create: orgProcedure(
    { paymentMethod: ["create"] },
    orgInput.extend({ name: shortName.max(120), accountId: z.uuid() }),
  ).handler(async ({ context, input }) => {
    const { orgId } = context.scope;

    return db
      .transaction(async (tx) => {
        await lockMoneyAccount(tx, orgId, input.accountId);

        const [created] = await tx
          .insert(paymentMethods)
          .values({ id: Bun.randomUUIDv7(), orgId, name: input.name, accountId: input.accountId })
          .returning();

        if (!created) throw impossible("Payment method insert returned no row");

        return created;
      })
      .catch((error: unknown) => {
        if (uniqueViolationConstraint(error) === "payment_methods_org_name_idx") {
          throw conflict("DUPLICATE", "A payment method with this name already exists.");
        }

        throw error;
      });
  }),

  // Retired methods stay on the documents that used them; only new documents skip them.
  setActive: orgProcedure(
    { paymentMethod: ["update"] },
    orgInput.extend({ paymentMethodId: z.uuid(), active: z.boolean() }),
  ).handler(async ({ context, input }) => {
    const [updated] = await db
      .update(paymentMethods)
      .set({ active: input.active, updatedAt: new Date() })
      .where(
        and(
          eq(paymentMethods.orgId, context.scope.orgId),
          eq(paymentMethods.id, input.paymentMethodId),
        ),
      )
      .returning({ id: paymentMethods.id });

    if (!updated) throw new ORPCError("NOT_FOUND", { message: "Payment method not found." });
  }),
};
