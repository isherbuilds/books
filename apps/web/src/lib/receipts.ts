import type { AppRouterClient } from "@accly/api/routers/index";

import { orpc } from "@/lib/orpc";

export type ReceiptListFilters = Omit<
  Parameters<AppRouterClient["receipt"]["list"]>[0],
  "orgSlug" | "cursor" | "limit"
>;

// One newest-first keyset list per filter set. The receipts page and a party's
// Receipts tab share it, so posting a receipt refreshes both through one key.
export const receiptListOptions = (orgSlug: string, filters: ReceiptListFilters) =>
  orpc.receipt.list.infiniteOptions({
    input: (cursor: string | undefined) => ({ orgSlug, ...filters, cursor, limit: 50 }),
    initialPageParam: undefined,
    getNextPageParam: (last) => (last.hasMore ? last.rows.at(-1)?.id : undefined),
  });
