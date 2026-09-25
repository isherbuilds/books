import type { AppRouterClient } from "@accly/api/routers/index";

import { orpc } from "@/lib/orpc";

type PaymentListFilters = Omit<
  Parameters<AppRouterClient["payment"]["list"]>[0],
  "orgSlug" | "cursor" | "limit"
>;

export const paymentListOptions = (orgSlug: string, filters: PaymentListFilters) =>
  orpc.payment.list.infiniteOptions({
    input: (cursor: string | undefined) => ({ orgSlug, ...filters, cursor }),
    initialPageParam: undefined,
    getNextPageParam: (last) => (last.hasMore ? last.rows.at(-1)?.id : undefined),
  });
