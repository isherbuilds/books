import type { AppRouterClient } from "@accly/api/routers/index";

import { keysetPaging, orpc } from "@/lib/orpc";

type ReceiptListFilters = Omit<
  Parameters<AppRouterClient["receipt"]["list"]>[0],
  "orgSlug" | "cursor" | "limit"
>;

// One newest-first keyset list per filter set. The receipts page and a party's
// Receipts tab share it, so posting a receipt refreshes both through one key.
export const receiptListOptions = (orgSlug: string, filters: ReceiptListFilters) =>
  orpc.receipt.list.infiniteOptions({
    input: (cursor: string | undefined) => ({ orgSlug, ...filters, cursor }),
    ...keysetPaging,
  });

// A cached master like party.list: every method, active or not, since old receipts
// name retired ones. The receipts page, its form and Banks settings share one entry.
export const paymentMethodListOptions = (orgSlug: string) => ({
  ...orpc.paymentMethod.list.queryOptions({ input: { orgSlug } }),
  staleTime: 5 * 60_000,
});

export const receiptDetailOptions = (orgSlug: string, receiptId: string) =>
  orpc.receipt.get.queryOptions({ input: { orgSlug, receiptId } });
