import { orpc } from "@/lib/orpc";

export const openingBalanceOptions = (orgSlug: string) =>
  orpc.openingBalance.get.queryOptions({ input: { orgSlug } });
