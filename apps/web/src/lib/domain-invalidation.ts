import type { QueryKey } from "@tanstack/react-query";

import { orpc } from "./orpc";

type QueryInvalidator = {
  invalidateQueries: (filters: { queryKey: QueryKey }) => Promise<void>;
};

export async function invalidateReceiptState(
  queryClient: QueryInvalidator,
  orgSlug: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: orpc.receipt.list.key({ input: { orgSlug } }),
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.receipt.partyTotals.key({ input: { orgSlug } }),
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.party.statement.key({ input: { orgSlug } }),
    }),
    // A receipt moves the cash or bank leaf its method names.
    queryClient.invalidateQueries({
      queryKey: orpc.account.moneyBalances.key({ input: { orgSlug } }),
    }),
  ]);
}

// Every party read for one org: the master list, the record, and anything keyed
// under `party`. Receipt totals do not change when a party is edited.
export function invalidatePartyState(queryClient: QueryInvalidator, orgSlug: string) {
  return queryClient.invalidateQueries({
    queryKey: orpc.party.key({ input: { orgSlug } }),
  });
}
