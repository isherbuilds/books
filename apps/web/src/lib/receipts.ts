import type { DocumentCursor } from "@accly/api/lib/schemas";
import type { AppRouterClient } from "@accly/api/routers/index";

import { datedPaging, orpc } from "@/lib/orpc";

type ReceiptListFilters = Omit<
  Parameters<AppRouterClient["receipt"]["list"]>[0],
  "orgSlug" | "cursor" | "limit"
>;

export type ReceiptDetail = Awaited<ReturnType<AppRouterClient["receipt"]["get"]>>;

// One newest-first keyset list per filter set. The receipts page and a party's
// Receipts tab share it, so posting a receipt refreshes both through one key.
export const receiptListOptions = (orgSlug: string, filters: ReceiptListFilters) =>
  orpc.receipt.list.infiniteOptions({
    input: (cursor: DocumentCursor | undefined) => ({ orgSlug, ...filters, cursor }),
    ...datedPaging,
  });

// A cached master like party.list: every method, active or not, since old receipts
// name retired ones. The receipts page, its form and Banks settings share one entry.
export const paymentMethodListOptions = (orgSlug: string) => ({
  ...orpc.paymentMethod.list.queryOptions({ input: { orgSlug } }),
  staleTime: 5 * 60_000,
});

/** The methods money can move through now: active, in an active account. */
export const activePaymentMethodsOptions = (orgSlug: string) => ({
  ...paymentMethodListOptions(orgSlug),
  select: (rows: Awaited<ReturnType<AppRouterClient["paymentMethod"]["list"]>>) =>
    rows.filter((method) => method.active && method.accountActive),
});

export const receiptDetailOptions = (orgSlug: string, receiptId: string) =>
  orpc.receipt.get.queryOptions({ input: { orgSlug, receiptId } });
