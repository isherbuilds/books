import { db, type DbTransaction } from "@accly/db";
import { accounts, type AccountType, type SupplyClass } from "@accly/db/schema/accounts";
import { and, asc, eq, getTableColumns, inArray, isNull, ne, notExists, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { MONEY_KINDS } from "@accly/db/schema/money-kinds";

import { MASTER_LIST_LIMIT } from "../lib/master-list";

const JOURNAL_SYSTEM_KEYS = ["tdsPayable", "tdsReceivable", "roundOff", "openingEquity"] as const;

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
 * omitted from the result. Inside a transaction each returned account is
 * share-locked, so none is archived under the posting that names it.
 */
export async function postableAccounts(
  executor: typeof db | DbTransaction,
  orgId: string,
  ids: readonly string[],
  types: readonly AccountType[],
) {
  if (ids.length === 0) return [];

  const query = executor
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

  return executor === db ? query : query.for("share", { of: accounts });
}

/**
 * Journal lines may name active leaves of any account type, including money
 * leaves. Non-system leaves and the TDS payable/receivable, round-off and opening
 * equity system accounts are allowed; new system keys are refused by default.
 * Registered organizations cannot journal taxable supply accounts. Unresolved ids
 * are omitted from the result.
 */
export async function journalAccounts(
  executor: DbTransaction | typeof db,
  orgId: string,
  options: { gstin: string | null; ids?: readonly string[] },
): Promise<Array<{ id: string; code: string; name: string; supplyClass: SupplyClass | null }>> {
  const query = executor
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      supplyClass: accounts.supplyClass,
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.orgId, orgId),
        options.ids ? inArray(accounts.id, [...options.ids]) : undefined,
        eq(accounts.active, true),
        or(isNull(accounts.systemKey), inArray(accounts.systemKey, [...JOURNAL_SYSTEM_KEYS])),
        options.gstin
          ? or(isNull(accounts.supplyClass), ne(accounts.supplyClass, "taxable"))
          : undefined,
        isLeaf(orgId),
      ),
    )
    .orderBy(asc(accounts.code), asc(accounts.id));

  return options.ids ? query.for("share") : query.limit(MASTER_LIST_LIMIT + 1);
}
