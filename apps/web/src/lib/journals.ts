import type { AppRouterClient } from "@accly/api/routers/index";

import { orpc } from "@/lib/orpc";

type JournalListFilters = Omit<
  Parameters<AppRouterClient["journal"]["list"]>[0],
  "orgSlug" | "cursor" | "limit"
>;

export const journalListOptions = (orgSlug: string, filters: JournalListFilters) =>
  orpc.journal.list.infiniteOptions({
    input: (cursor: string | undefined) => ({ orgSlug, ...filters, cursor }),
    initialPageParam: undefined,
    getNextPageParam: (last) => (last.hasMore ? last.rows.at(-1)?.id : undefined),
  });

export const journalAccountOptions = (orgSlug: string) => ({
  ...orpc.journal.accounts.queryOptions({ input: { orgSlug } }),
  staleTime: 5 * 60_000,
});
