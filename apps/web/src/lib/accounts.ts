import type { AppRouterClient } from "@accly/api/routers/index";

import { orpc } from "@/lib/orpc";

export type AccountListRow = Awaited<ReturnType<AppRouterClient["account"]["list"]>>[number];

/** A chart row with the facts the chart page derives from its neighbours. */
export type AccountRow = AccountListRow & { isGroup: boolean; parentName: string | null };

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
