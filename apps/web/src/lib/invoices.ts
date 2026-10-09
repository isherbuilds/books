import type { DocumentCursor } from "@accly/api/lib/schemas";
import type { AppRouterClient } from "@accly/api/routers/index";

import { nextPage, orpc } from "@/lib/orpc";

/** Invoice lines are net of discount, so the subtotal before discount adds it back. */
export const subtotalBeforeDiscountPaise = (taxablePaise: bigint, discountPaise: bigint) =>
  taxablePaise + discountPaise;

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
    input: (cursor: DocumentCursor | undefined) => ({ orgSlug, ...filters, cursor }),
    ...nextPage,
  });

export const invoiceDetailOptions = (orgSlug: string, invoiceId: string) =>
  orpc.invoice.get.queryOptions({ input: { orgSlug, invoiceId } });

// The register's one-line aggregate over the whole filter, not the loaded page.
export const invoiceTotalsOptions = (
  orgSlug: string,
  filters: Omit<Parameters<AppRouterClient["invoice"]["totals"]>[0], "orgSlug">,
) => orpc.invoice.totals.queryOptions({ input: { orgSlug, ...filters } });
