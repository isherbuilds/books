import type { QueryKey } from "@tanstack/react-query";

import { orpc } from "./orpc";

type QueryInvalidator = {
  invalidateQueries: (filters: { queryKey: QueryKey }) => Promise<void>;
};

// Every read a receipt, invoice, allocation or cancel write can move: both document
// families, the party statement, and the cash or bank leaf a receipt's method names.
// Invalidation refetches only mounted queries, so no write narrows this list.
export async function invalidateDocumentState(
  queryClient: QueryInvalidator,
  orgSlug: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: orpc.receipt.key({ input: { orgSlug } }) }),
    queryClient.invalidateQueries({ queryKey: orpc.invoice.key({ input: { orgSlug } }) }),
    queryClient.invalidateQueries({
      queryKey: orpc.party.statement.key({ input: { orgSlug } }),
    }),
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

export function invalidateItems(queryClient: QueryInvalidator, orgSlug: string) {
  return queryClient.invalidateQueries({
    queryKey: orpc.item.key({ input: { orgSlug } }),
  });
}
