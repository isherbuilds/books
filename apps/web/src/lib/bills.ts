import type { DocumentCursor } from "@accly/api/lib/schemas";
import type { AppRouterClient } from "@accly/api/routers/index";

import { nextPage, orpc } from "@/lib/orpc";

type BillListFilters = Omit<
  Parameters<AppRouterClient["bill"]["list"]>[0],
  "orgSlug" | "cursor" | "limit"
>;

export type BillListRow = Awaited<ReturnType<AppRouterClient["bill"]["list"]>>["rows"][number];

export type BillDetail = Awaited<ReturnType<AppRouterClient["bill"]["get"]>>;

export const billListOptions = (orgSlug: string, filters: BillListFilters) =>
  orpc.bill.list.infiniteOptions({
    input: (cursor: DocumentCursor | undefined) => ({ orgSlug, ...filters, cursor }),
    ...nextPage,
  });

export const billDetailOptions = (orgSlug: string, billId: string) =>
  orpc.bill.get.queryOptions({ input: { orgSlug, billId } });

// The register's one-line aggregate over the whole filter, not the loaded page.
export const billTotalsOptions = (
  orgSlug: string,
  filters: Omit<Parameters<AppRouterClient["bill"]["totals"]>[0], "orgSlug">,
) => orpc.bill.totals.queryOptions({ input: { orgSlug, ...filters } });
