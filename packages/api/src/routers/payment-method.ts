import { db } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { paymentMethods } from "@accly/db/schema/payment-methods";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { uniqueViolationConstraint } from "../lib/db-errors";
import { capMasterList, MASTER_LIST_LIMIT } from "../lib/master-list";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { shortName } from "../lib/schemas";

export const paymentMethodRouter = {
  list: orgProcedure({ paymentMethod: ["read"] }, orgInput).handler(async ({ context }) => {
    const rows = await db
      .select()
      .from(paymentMethods)
      .where(eq(paymentMethods.orgId, context.scope.orgId))
      .orderBy(asc(paymentMethods.name), asc(paymentMethods.id))
      .limit(MASTER_LIST_LIMIT + 1);

    return capMasterList(rows);
  }),

  create: orgProcedure(
    { paymentMethod: ["create"] },
    orgInput.extend({ name: shortName.max(120), accountId: z.string().uuid() }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    try {
      return await db.transaction(async (tx) => {
        // A Payment Method settles cash: the account is a cash/bank mapping or a
        // child of one (a second bank account added under "Bank").
        const parent = alias(accounts, "parent");

        const [account] = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .leftJoin(parent, and(eq(parent.orgId, accounts.orgId), eq(parent.id, accounts.parentId)))
          .where(
            and(
              eq(accounts.orgId, scope.orgId),
              eq(accounts.id, input.accountId),
              eq(accounts.active, true),
              eq(accounts.type, "asset"),
              or(
                inArray(accounts.systemKey, ["cash", "bank"]),
                inArray(parent.systemKey, ["cash", "bank"]),
              ),
            ),
          )
          .limit(1);

        if (!account) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Payment methods settle into a cash or bank account.",
            data: { reason: "ACCOUNT_NOT_CASH_OR_BANK" },
          });
        }

        const [created] = await tx
          .insert(paymentMethods)
          .values({
            id: Bun.randomUUIDv7(),
            orgId: scope.orgId,
            name: input.name,
            accountId: account.id,
          })
          .returning();

        if (!created) throw new Error("Payment method insert returned no row");

        return created;
      });
    } catch (error) {
      if (uniqueViolationConstraint(error) === "payment_methods_org_name_idx") {
        throw new ORPCError("CONFLICT", {
          message: "A payment method with this name already exists.",
          data: { reason: "PAYMENT_METHOD_NAME_TAKEN" },
        });
      }

      throw error;
    }
  }),
};
