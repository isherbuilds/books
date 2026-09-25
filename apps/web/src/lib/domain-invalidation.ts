import type { QueryKey } from "@tanstack/react-query";

import { orpc } from "./orpc";

type QueryInvalidator = {
  invalidateQueries: (filters: { queryKey: QueryKey }) => Promise<void>;
};

// Each set covers one kind of write. Every mutation calls the set for what it moved,
// on success and on an uncertain result alike; a broader set would refetch every
// mounted register and balance for a draft that touched none of them.

export function invalidateLockState(queryClient: QueryInvalidator, orgSlug: string) {
  return queryClient.invalidateQueries({
    queryKey: orpc.lock.get.key({ input: { orgSlug } }),
  });
}

// A draft save or discard changes only invoice reads.
export function invalidateInvoiceDrafts(queryClient: QueryInvalidator, orgSlug: string) {
  return queryClient.invalidateQueries({ queryKey: orpc.invoice.key({ input: { orgSlug } }) });
}

// Posting or cancelling an invoice, bill or note and applying or reversing an
// allocation move outstanding, unapplied and the party statement and pickers, never a
// cash or bank balance.
export async function invalidateSettlementState(
  queryClient: QueryInvalidator,
  orgSlug: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: orpc.receipt.key({ input: { orgSlug } }) }),
    queryClient.invalidateQueries({ queryKey: orpc.invoice.key({ input: { orgSlug } }) }),
    queryClient.invalidateQueries({ queryKey: orpc.payment.key({ input: { orgSlug } }) }),
    queryClient.invalidateQueries({ queryKey: orpc.bill.key({ input: { orgSlug } }) }),
    queryClient.invalidateQueries({ queryKey: orpc.note.key({ input: { orgSlug } }) }),
    queryClient.invalidateQueries({ queryKey: orpc.party.statement.key({ input: { orgSlug } }) }),
    queryClient.invalidateQueries({ queryKey: orpc.party.openItems.key({ input: { orgSlug } }) }),
    queryClient.invalidateQueries({
      queryKey: orpc.party.openCredits.key({ input: { orgSlug } }),
    }),
  ]);
}

// A bill draft save or discard changes only bill reads.
export function invalidateBillDrafts(queryClient: QueryInvalidator, orgSlug: string) {
  return queryClient.invalidateQueries({ queryKey: orpc.bill.key({ input: { orgSlug } }) });
}

// Posting or cancelling a receipt or payment also moves the cash or bank leaf its
// method names.
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

// Journals move account balances without writing the party ledger.
export async function invalidateJournalState(
  queryClient: QueryInvalidator,
  orgSlug: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: orpc.journal.list.key({ input: { orgSlug } }),
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.journal.get.key({ input: { orgSlug } }),
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.account.moneyBalances.key({ input: { orgSlug } }),
    }),
  ]);
}

// Opening balances move their document read and account balances together.
export async function invalidateOpeningBalanceState(
  queryClient: QueryInvalidator,
  orgSlug: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: orpc.openingBalance.get.key({ input: { orgSlug } }),
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

// Account writes change the chart (every list variant and money balances), the journal
// pickers, and the account names Items and Payment Methods display.
export async function invalidateAccountState(
  queryClient: QueryInvalidator,
  orgSlug: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: orpc.account.key({ input: { orgSlug } }) }),
    queryClient.invalidateQueries({ queryKey: orpc.journal.accounts.key({ input: { orgSlug } }) }),
    queryClient.invalidateQueries({ queryKey: orpc.paymentMethod.key({ input: { orgSlug } }) }),
    invalidateItems(queryClient, orgSlug),
  ]);
}

export function invalidatePaymentMethods(queryClient: QueryInvalidator, orgSlug: string) {
  return queryClient.invalidateQueries({
    queryKey: orpc.paymentMethod.key({ input: { orgSlug } }),
  });
}

// An invitation changes only the roster.
export function invalidateRoster(queryClient: QueryInvalidator, orgSlug: string) {
  return queryClient.invalidateQueries({ queryKey: orpc.member.list.key({ input: { orgSlug } }) });
}

// A role change or removal can be the viewer's own, which `member.me` carries.
export async function invalidateMembership(
  queryClient: QueryInvalidator,
  orgSlug: string,
): Promise<void> {
  await Promise.all([
    invalidateRoster(queryClient, orgSlug),
    queryClient.invalidateQueries({ queryKey: orpc.member.me.key({ input: { orgSlug } }) }),
  ]);
}

// `member.me` carries the time zone every page formats with, and `journal.accounts`
// follows the GSTIN: a registered organization cannot journal taxable income.
export async function invalidateSettings(
  queryClient: QueryInvalidator,
  orgSlug: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: orpc.settings.get.key({ input: { orgSlug } }) }),
    queryClient.invalidateQueries({ queryKey: orpc.member.me.key({ input: { orgSlug } }) }),
    queryClient.invalidateQueries({ queryKey: orpc.journal.accounts.key({ input: { orgSlug } }) }),
  ]);
}

export function invalidateFiles(queryClient: QueryInvalidator, orgSlug: string) {
  return queryClient.invalidateQueries({ queryKey: orpc.file.list.key({ input: { orgSlug } }) });
}
