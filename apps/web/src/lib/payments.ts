import type { AppRouterClient } from "@accly/api/routers/index";

import { keysetPaging, orpc } from "@/lib/orpc";

type PaymentListFilters = Omit<
  Parameters<AppRouterClient["payment"]["list"]>[0],
  "orgSlug" | "cursor" | "limit"
>;

export const paymentListOptions = (orgSlug: string, filters: PaymentListFilters) =>
  orpc.payment.list.infiniteOptions({
    input: (cursor: string | undefined) => ({ orgSlug, ...filters, cursor }),
    ...keysetPaging,
  });

export const paymentDetailOptions = (orgSlug: string, paymentId: string) =>
  orpc.payment.get.queryOptions({ input: { orgSlug, paymentId } });
