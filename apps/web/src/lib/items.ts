import type { AppRouter } from "@accly/api/routers/index";
import type { RouterClient } from "@orpc/server";

import { orpc } from "@/lib/orpc";

export type ItemListRow = Awaited<ReturnType<RouterClient<AppRouter>["item"]["list"]>>[number];

/** The complete item master shared by the settings page and invoice forms. */
export const itemListOptions = (orgSlug: string) => ({
  ...orpc.item.list.queryOptions({ input: { orgSlug } }),
  staleTime: 5 * 60_000,
});

// Tax rates in force on a date, or today without one.
export const taxRatesOptions = (orgSlug: string, date?: string) =>
  orpc.item.taxRates.queryOptions({ input: { orgSlug, date } });
