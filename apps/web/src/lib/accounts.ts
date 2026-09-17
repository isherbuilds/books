import { orpc } from "@/lib/orpc";

/** Active income accounts: what an item, an invoice line or a direct receipt credits. */
export const incomeAccountOptions = (orgSlug: string) => ({
  ...orpc.account.list.queryOptions({ input: { orgSlug, type: "income", activeOnly: true } }),
  staleTime: 5 * 60_000,
});
