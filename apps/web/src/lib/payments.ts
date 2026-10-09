import type { DocumentCursor } from "@accly/api/lib/schemas";
import type { AppRouterClient } from "@accly/api/routers/index";

import { OPERATIONAL_REFETCH } from "@/lib/operational-query";
import { nextPage, orpc } from "@/lib/orpc";

type PaymentListFilters = Omit<
  Parameters<AppRouterClient["payment"]["list"]>[0],
  "orgSlug" | "cursor" | "limit"
>;

export const paymentListOptions = (orgSlug: string, filters: PaymentListFilters) =>
  orpc.payment.list.infiniteOptions({
    input: (cursor: DocumentCursor | undefined) => ({ orgSlug, ...filters, cursor }),
    ...nextPage,
  });

export const paymentDetailOptions = (orgSlug: string, paymentId: string) =>
  orpc.payment.get.queryOptions({ input: { orgSlug, paymentId } });

// The register's one-line aggregate over the whole filter, not the loaded page.
export const paymentTotalsOptions = (
  orgSlug: string,
  filters: Omit<Parameters<AppRouterClient["payment"]["totals"]>[0], "orgSlug">,
) => ({
  ...orpc.payment.totals.queryOptions({ input: { orgSlug, ...filters } }),
  ...OPERATIONAL_REFETCH,
});

// TDS sections in force on a date. Callers disable it until the date is complete.
export const tdsSectionsOptions = (orgSlug: string, date?: string) =>
  orpc.payment.tdsSections.queryOptions({ input: { orgSlug, date } });

// The command palette's number/party/reference search over payments.
export const paymentSearchOptions = (orgSlug: string, q: string, limit: number) =>
  orpc.payment.list.queryOptions({ input: { orgSlug, q, limit } });
