import type { AppRouterClient } from "@accly/api/routers/index";

import { orpc } from "@/lib/orpc";

type InvoiceListFilters = Omit<
  Parameters<AppRouterClient["invoice"]["list"]>[0],
  "orgSlug" | "cursor" | "limit"
>;

export type InvoiceListRow = Awaited<
  ReturnType<AppRouterClient["invoice"]["list"]>
>["rows"][number];

export type InvoiceDetail = Awaited<ReturnType<AppRouterClient["invoice"]["get"]>>;

export const invoiceListOptions = (orgSlug: string, filters: InvoiceListFilters) =>
  orpc.invoice.list.infiniteOptions({
    input: (cursor: string | undefined) => ({ orgSlug, ...filters, cursor }),
    initialPageParam: undefined,
    getNextPageParam: (last) => (last.hasMore ? last.rows.at(-1)?.id : undefined),
  });

export const invoiceDetailOptions = (orgSlug: string, invoiceId: string) =>
  orpc.invoice.get.queryOptions({ input: { orgSlug, invoiceId } });
