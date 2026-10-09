import type { DocumentCursor } from "@accly/api/lib/schemas";

import { nextPage, orpc } from "@/lib/orpc";

export const openingBalanceOptions = (orgSlug: string) =>
  orpc.openingBalance.get.queryOptions({ input: { orgSlug } });

/** The imported opening items, oldest legacy date first, one page at a time. */
export const openingItemsOptions = (orgSlug: string) =>
  orpc.openingBalance.items.infiniteOptions({
    input: (cursor: DocumentCursor | undefined) => ({ orgSlug, cursor }),
    ...nextPage,
  });
