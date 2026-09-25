import type { AppRouterClient } from "@accly/api/routers/index";

import { orpc } from "@/lib/orpc";

export type AccountListRow = Awaited<ReturnType<AppRouterClient["account"]["list"]>>[number];

/** A chart row with the facts the chart page derives from its neighbours. */
export type AccountRow = AccountListRow & { isGroup: boolean; parentName: string | null };

/** The chart with each row's group flag and parent name, for the chart page and its Sheet. */
export function deriveAccountRows(accounts: AccountListRow[]): AccountRow[] {
  const byId = new Map<string, AccountListRow>();
  const groupIds = new Set<string>();

  for (const account of accounts) {
    byId.set(account.id, account);

    if (account.parentId) groupIds.add(account.parentId);
  }

  return accounts.map((account) => ({
    ...account,
    isGroup: groupIds.has(account.id),
    parentName: account.parentId ? (byId.get(account.parentId)?.name ?? null) : null,
  }));
}

/** The plain chart query, primed by the accounts route loader. */
export function accountListOptions(orgSlug: string) {
  return {
    ...orpc.account.list.queryOptions({ input: { orgSlug } }),
    staleTime: 5 * 60_000,
  };
}

/** Active income accounts: what an item, an invoice line or a direct receipt credits. */
export const incomeAccountOptions = (orgSlug: string) => ({
  ...orpc.account.list.queryOptions({ input: { orgSlug, type: "income", activeOnly: true } }),
  staleTime: 5 * 60_000,
});

/**
 * The leaves a document line may post to, from the full chart: active, not a system
 * account, not a group, and not a cash or bank leaf (a Payment Method owns those).
 */
export function postableAccounts(
  rows: readonly AccountListRow[],
  types: readonly AccountListRow["type"][],
): AccountListRow[] {
  const groupIds = new Set(rows.map((account) => account.parentId));

  const moneyGroupIds = new Set(
    rows.flatMap((account) =>
      account.systemKey === "cash" || account.systemKey === "bank" ? [account.id] : [],
    ),
  );

  return rows.filter(
    (account) =>
      account.active &&
      !account.systemKey &&
      !groupIds.has(account.id) &&
      types.includes(account.type) &&
      (account.parentId === null || !moneyGroupIds.has(account.parentId)),
  );
}
