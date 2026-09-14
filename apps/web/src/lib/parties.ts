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

// The complete master list, one cache entry per organization: the parties page,
// the Party Link Field and the palette share it and filter in memory.
export const partyListOptions = (orgSlug: string) => ({
  ...orpc.party.list.queryOptions({ input: { orgSlug } }),
  staleTime: 5 * 60_000,
});

// Receipt money per party, a separate read so posting a receipt never refetches
// the master. Sparse: a party with no posted receipt has no row. A party page passes
// its id and gets at most its own row.
export const partyTotalsOptions = (orgSlug: string, partyId?: string) =>
  orpc.receipt.partyTotals.queryOptions({ input: { orgSlug, partyId } });

// The party page reads the whole statement for its balance and the Ledger tab reads a
// period; with no period both share one cache entry.
export const partyStatementOptions = (
  orgSlug: string,
  partyId: string,
  period: { from?: string; to?: string } = {},
) => orpc.party.statement.queryOptions({ input: { orgSlug, partyId, ...period } });

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
