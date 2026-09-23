import type { AppRouterClient } from "@accly/api/routers/index";

import { orpc } from "@/lib/orpc";

type MoneyAccount = Awaited<ReturnType<AppRouterClient["account"]["moneyBalances"]>>[number];

type MoneyGroup = { id: string; name: string; leaves: MoneyAccount[] };

export const moneyBalanceOptions = (orgSlug: string) =>
  orpc.account.moneyBalances.queryOptions({ input: { orgSlug } });

/** `account.moneyBalances` rows under their Cash or Bank Accounts group, in row order. */
export function groupMoneyAccounts(rows: readonly MoneyAccount[]): MoneyGroup[] {
  const groups = new Map<string, MoneyGroup>();

  for (const row of rows) {
    const group = groups.get(row.groupId) ?? { id: row.groupId, name: row.groupName, leaves: [] };
    group.leaves.push(row);
    groups.set(row.groupId, group);
  }

  return [...groups.values()];
}
