import type { AppRouterClient } from "@accly/api/routers/index";
import { skipToken, useQuery } from "@tanstack/react-query";
import type { LinkOptions } from "@tanstack/react-router";

import { nextPage, orpc } from "@/lib/orpc";

// Mirrors PARTY_ROLES in @accly/db, kept local so no server schema module reaches
// the client bundle (hard rule 6).
export const PARTY_ROLES = [
  "customer",
  "vendor",
  "tenant",
  "donor",
  "employee",
  "government",
] as const;

export type PartyRole = (typeof PARTY_ROLES)[number];

export const ROLE_LABELS: Record<PartyRole, string> = {
  customer: "Customer",
  vendor: "Vendor",
  tenant: "Tenant",
  donor: "Donor",
  employee: "Employee",
  government: "Government",
};

type PartyList = Awaited<ReturnType<AppRouterClient["party"]["list"]>>;

export type PartyListRow = PartyList["rows"][number];

// The master, one cache entry per organization: the parties page, the Party Link
// Field and the palette share it and filter in memory. Past 5,000 parties `hasMore`
// is true and each of them searches the server with `q` instead. The master's key
// carries no `q`, so invalidating it also reaches every search.
export const partyListOptions = (orgSlug: string, q?: string) => ({
  ...orpc.party.list.queryOptions({ input: q ? { orgSlug, q } : { orgSlug } }),
  staleTime: 5 * 60_000,
});

// No `partyId` skips the read, so a form or filter can subscribe before a party is chosen.
export const partyDetailOptions = (orgSlug: string, partyId: string | undefined) =>
  orpc.party.get.queryOptions({ input: partyId ? { orgSlug, partyId } : skipToken });

/** The active rows a Link Field offers: id, name and GSTIN. */
export type PartyOption = { id: string; name: string; gstin?: string | null };

export type PartyPicker = { rows: PartyOption[]; hasMore: boolean };

// Roles are descriptive (accounting-core), so a picker ranks the parties holding the
// document's role first and never hides the rest. Both groups keep name order.
function pickableParties({ rows, hasMore }: PartyList, role: PartyRole | undefined): PartyPicker {
  if (!role) return { rows: rows.filter((party) => party.active), hasMore };

  const preferred: PartyListRow[] = [];
  const others: PartyListRow[] = [];

  for (const party of rows) {
    if (!party.active) continue;
    (party.roles.includes(role) ? preferred : others).push(party);
  }

  return { rows: [...preferred, ...others], hasMore };
}

export const partyPickerOptions = (orgSlug: string, role?: PartyRole, q?: string) => ({
  ...partyListOptions(orgSlug, q),
  select: (list: PartyList) => pickableParties(list, role),
});

/**
 * A linked party's name. Loaded `rows` answer first; a party past the 5,000-row cap,
 * or with no rows given, is read with `party.get`. Pass no `partyId` when the viewer
 * cannot read parties.
 */
export function usePartyName(orgSlug: string, partyId: string | undefined, rows?: PartyOption[]) {
  const listed = partyId ? rows?.find((party) => party.id === partyId) : undefined;

  const fetched = useQuery(partyDetailOptions(orgSlug, listed ? undefined : partyId));

  return listed?.name ?? fetched.data?.name;
}

// Receipt money per party, a separate read so posting a receipt never refetches
// the master. Sparse: a party with no posted receipt has no row. A party page passes
// its id and gets at most its own row.
export const partyTotalsOptions = (orgSlug: string, partyId?: string) =>
  orpc.receipt.partyTotals.queryOptions({ input: { orgSlug, partyId } });

// Every party's closing balance through today's Organization business date for Home
// and the register. Sparse: no ledger line through today means no row.
export const partyBalancesOptions = (orgSlug: string) =>
  orpc.party.balances.queryOptions({ input: { orgSlug } });

// Shared by the overview and transactions balance; the ledger tab also supplies its range.
export const partyLedgerSummaryOptions = (
  orgSlug: string,
  partyId: string,
  range: { from?: string; to?: string } = {},
) => orpc.party.ledgerSummary.queryOptions({ input: { orgSlug, partyId, ...range } });

export const partyLedgerLinesOptions = (
  orgSlug: string,
  partyId: string,
  range: { from?: string; to?: string },
) =>
  orpc.party.ledgerLines.infiniteOptions({
    input: (cursor: { entryDate: string; id: string } | undefined) => ({
      orgSlug,
      partyId,
      ...range,
      cursor,
    }),
    ...nextPage,
  });

// Every document naming the party, newest first, one keyset page at a time.
export const partyTransactionsOptions = (
  orgSlug: string,
  partyId: string,
  range: { from?: string; to?: string },
) =>
  orpc.party.transactions.infiniteOptions({
    input: (cursor: string | undefined) => ({ orgSlug, partyId, ...range, cursor }),
    ...nextPage,
  });

export const PARTY_STATUSES = ["active", "inactive"] as const;

export const GST_FILTERS = ["registered", "unregistered"] as const;

export type PartyFilters = {
  q?: string;
  status?: (typeof PARTY_STATUSES)[number];
  roles?: PartyRole[];
  gst?: (typeof GST_FILTERS)[number];
};

type FilterableParty = {
  name: string;
  roles: PartyRole[];
  active: boolean;
  gstin: string | null;
};

// Roles match when any selected role applies, as Midday's status filter does.
export function filterParties<T extends FilterableParty>(parties: T[], filters: PartyFilters): T[] {
  const { status, roles, gst } = filters;
  const needle = filters.q?.toLowerCase();

  return parties.filter(
    (party) =>
      (!status || party.active === (status === "active")) &&
      (!roles || party.roles.some((role) => roles.includes(role))) &&
      (!gst || (party.gstin !== null) === (gst === "registered")) &&
      (!needle ||
        party.name.toLowerCase().includes(needle) ||
        party.gstin?.toLowerCase().includes(needle) === true),
  );
}

type PartyDocumentType =
  | "invoice"
  | "bill"
  | "creditNote"
  | "debitNote"
  | "receipt"
  | "payment"
  | "journal"
  | "openingBalance"
  | "openingClaim"
  | "openingCredit";

// One route table for party registers and accounting reports. Allocations have
// journal entries but no document record to open.
export function documentLink(orgSlug: string, type: PartyDocumentType, id: string): LinkOptions;
export function documentLink(orgSlug: string, type: string, id: string): LinkOptions | undefined;
export function documentLink(orgSlug: string, type: string, id: string): LinkOptions | undefined {
  switch (type) {
    case "invoice":
      return { to: "/$orgSlug/invoices/$invoiceId", params: { orgSlug, invoiceId: id } };
    case "bill":
      return { to: "/$orgSlug/bills/$billId", params: { orgSlug, billId: id } };
    case "creditNote":
    case "debitNote":
      return { to: "/$orgSlug/notes/$noteId", params: { orgSlug, noteId: id } };
    case "receipt":
      return { to: "/$orgSlug/receipts/$receiptId", params: { orgSlug, receiptId: id } };
    case "payment":
      return { to: "/$orgSlug/payments/$paymentId", params: { orgSlug, paymentId: id } };
    case "journal":
      return { to: "/$orgSlug/journals/$journalId", params: { orgSlug, journalId: id } };
    // Opening items are listed on the Opening Balance page.
    case "openingBalance":
    case "openingClaim":
    case "openingCredit":
      return { to: "/$orgSlug/settings/opening-balance", params: { orgSlug } };
    default:
      return undefined;
  }
}

// Each party document opens over its register filtered to that party. Journal
// and opening records are pages rather than filtered register Sheets.
export function partyDocumentLink(
  orgSlug: string,
  partyId: string,
  type: PartyDocumentType,
  id: string,
): LinkOptions {
  const link = documentLink(orgSlug, type, id);

  return type === "journal" || type.startsWith("opening") ? link : { ...link, search: { partyId } };
}
