import type { AppRouterClient } from "@accly/api/routers/index";
import { skipToken, useQuery } from "@tanstack/react-query";
import type { LinkOptions } from "@tanstack/react-router";

import { orpc } from "@/lib/orpc";

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

export const partyDetailOptions = (orgSlug: string, partyId: string) =>
  orpc.party.get.queryOptions({ input: { orgSlug, partyId } });

/** The active rows a Link Field offers: id, name and GSTIN. */
export type PartyOption = { id: string; name: string; gstin?: string | null };

export type PartyPicker = { rows: PartyOption[]; hasMore: boolean };

// Roles are descriptive (accounting-core), so a picker ranks the parties holding the
// document's role first and never hides the rest. Both groups keep name order.
function pickableParties({ rows, hasMore }: PartyList, role: PartyRole | undefined): PartyPicker {
  const active = rows.filter((party) => party.active);

  if (!role) return { rows: active, hasMore };

  const holds = (party: PartyListRow) => party.roles.includes(role);

  return { rows: [...active.filter(holds), ...active.filter((party) => !holds(party))], hasMore };
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

  const fetched = useQuery(
    orpc.party.get.queryOptions({
      input: partyId && !listed ? { orgSlug, partyId } : skipToken,
    }),
  );

  return listed?.name ?? fetched.data?.name;
}

// Receipt money per party, a separate read so posting a receipt never refetches
// the master. Sparse: a party with no posted receipt has no row. A party page passes
// its id and gets at most its own row.
export const partyTotalsOptions = (orgSlug: string, partyId?: string) =>
  orpc.receipt.partyTotals.queryOptions({ input: { orgSlug, partyId } });

// Every party's closing balance for the register, a separate read so posting never
// refetches the master. Sparse: a party with no ledger line has no row.
export const partyBalancesOptions = (orgSlug: string) =>
  orpc.party.balances.queryOptions({ input: { orgSlug } });

// The party page reads the whole statement for its balance; the Ledger tab
// requests its selected date range.
export const partyStatementOptions = (
  orgSlug: string,
  partyId: string,
  range: { from?: string; to?: string } = {},
) => orpc.party.statement.queryOptions({ input: { orgSlug, partyId, ...range } });

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
  | "openingBalance";

// Each record opens over its own register filtered to the party, so Back and the list
// behind the Sheet stay on that party's documents.
export function partyDocumentLink(
  orgSlug: string,
  partyId: string,
  type: PartyDocumentType,
  id: string,
): LinkOptions {
  switch (type) {
    case "invoice":
      return {
        to: "/$orgSlug/invoices/$invoiceId",
        params: { orgSlug, invoiceId: id },
        search: { partyId },
      };
    case "bill":
      return {
        to: "/$orgSlug/bills/$billId",
        params: { orgSlug, billId: id },
        search: { partyId },
      };
    case "creditNote":
    case "debitNote":
      return {
        to: "/$orgSlug/notes/$noteId",
        params: { orgSlug, noteId: id },
        search: { partyId },
      };
    case "receipt":
      return {
        to: "/$orgSlug/receipts/$receiptId",
        params: { orgSlug, receiptId: id },
        search: { partyId },
      };
    case "payment":
      return {
        to: "/$orgSlug/payments/$paymentId",
        params: { orgSlug, paymentId: id },
        search: { partyId },
      };
    case "journal":
      return { to: "/$orgSlug/journals/$journalId", params: { orgSlug, journalId: id } };
    case "openingBalance":
      return { to: "/$orgSlug/settings/opening-balance", params: { orgSlug } };
  }
}
