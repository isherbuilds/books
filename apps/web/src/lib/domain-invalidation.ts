import type { QueryKey } from "@tanstack/react-query";

import { orpc } from "./orpc";

type QueryInvalidator = {
  invalidateQueries: (filters: { queryKey: QueryKey }) => Promise<void>;
};

// Three sets, one per kind of write. Each mutation calls the set for what it moved,
// on success and on an uncertain result alike; a broader set would refetch every
// mounted register and balance for a draft that touched none of them.

// A draft save or discard changes only invoice reads.
export function invalidateInvoiceDrafts(queryClient: QueryInvalidator, orgSlug: string) {
  return queryClient.invalidateQueries({ queryKey: orpc.invoice.key({ input: { orgSlug } }) });
}

// Posting or cancelling an invoice and applying or reversing an allocation move
// outstanding, unapplied and the party statement, never a cash or bank balance.
export async function invalidateSettlementState(
  queryClient: QueryInvalidator,
  orgSlug: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: orpc.receipt.key({ input: { orgSlug } }) }),
    queryClient.invalidateQueries({ queryKey: orpc.invoice.key({ input: { orgSlug } }) }),
    queryClient.invalidateQueries({
      queryKey: orpc.party.statement.key({ input: { orgSlug } }),
    }),
  ]);
}

// Posting or cancelling a receipt also moves the cash or bank leaf its method names.
export async function invalidateCashState(
  queryClient: QueryInvalidator,
  orgSlug: string,
): Promise<void> {
  await Promise.all([
    invalidateSettlementState(queryClient, orgSlug),
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
