import type { DocumentCursor } from "@accly/api/lib/schemas";
import type { AppRouterClient } from "@accly/api/routers/index";

import { nextPage, orpc } from "@/lib/orpc";

type JournalListFilters = Omit<
  Parameters<AppRouterClient["journal"]["list"]>[0],
  "orgSlug" | "cursor" | "limit"
>;

export const journalListOptions = (orgSlug: string, filters: JournalListFilters) =>
  orpc.journal.list.infiniteOptions({
    input: (cursor: DocumentCursor | undefined) => ({ orgSlug, ...filters, cursor }),
    ...nextPage,
  });

export const journalAccountOptions = (orgSlug: string) => ({
  ...orpc.journal.accounts.queryOptions({ input: { orgSlug } }),
  staleTime: 5 * 60_000,
});

export const journalDetailOptions = (orgSlug: string, journalId: string) =>
  orpc.journal.get.queryOptions({ input: { orgSlug, journalId } });
