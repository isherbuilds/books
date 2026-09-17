import { db } from "@accly/db";
import { accounts, type AccountType } from "@accly/db/schema/accounts";
import { and, eq, getTableColumns, inArray, isNull, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { MONEY_KINDS } from "@accly/db/schema/money-kinds";

// Which accounts a document may name directly. Every read is scoped to the org.

/** The cash or bank group above a money leaf. Join it with `underMoneyGroup`. */
export const moneyGroup = alias(accounts, "money_group");

/** Matches `moneyGroup` when `accounts` sits directly under the cash or bank group. */
export function underMoneyGroup(orgId: string) {
  return and(
    eq(moneyGroup.orgId, orgId),
    eq(moneyGroup.id, accounts.parentId),
    inArray(moneyGroup.systemKey, [...MONEY_KINDS]),
  );
}

const child = alias(accounts, "child");

/** A group account such as Current Assets only totals its children. */
export function isLeaf(orgId: string) {
  return notExists(
    db
      .select({ id: child.id })
      .from(child)
      .where(and(eq(child.orgId, orgId), eq(child.parentId, accounts.id))),
  );
}

/**
 * Active, non-system leaves of one of `types` that are not money accounts: money
 * moves between money accounts only by the slice 5 Journal. Unresolved ids are
 * omitted from the result.
 */
export async function postableAccounts(
  orgId: string,
  ids: readonly string[],
  types: readonly AccountType[],
): Promise<Array<typeof accounts.$inferSelect>> {
  if (ids.length === 0) return [];

  return db
    .select(getTableColumns(accounts))
    .from(accounts)
    .leftJoin(moneyGroup, underMoneyGroup(orgId))
    .where(
      and(
        eq(accounts.orgId, orgId),
        inArray(accounts.id, [...ids]),
        eq(accounts.active, true),
        inArray(accounts.type, [...types]),
        isNull(accounts.systemKey),
        isNull(moneyGroup.id),
        isLeaf(orgId),
      ),
    );
}

export async function postableAccount(
  orgId: string,
  id: string,
  types: readonly AccountType[],
): Promise<typeof accounts.$inferSelect | undefined> {
  const [row] = await postableAccounts(orgId, [id], types);

  return row;
}
