import { INDIAN_STATES } from "@accly/api/lib/indian-states";

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
// the master. Sparse: a party with no posted receipt has no row.
export const partyTotalsOptions = (orgSlug: string) =>
  orpc.receipt.partyTotals.queryOptions({ input: { orgSlug } });

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
  stateCodes?: string[];
  gst?: (typeof GST_FILTERS)[number];
};

type FilterableParty = {
  name: string;
  roles: PartyRole[];
  stateCode: string;
  active: boolean;
  gstin: string | null;
  pan: string | null;
  phone: string | null;
  email: string | null;
};

// Roles match when any selected role applies, as Midday's status filter does.
export function filterParties<T extends FilterableParty>(parties: T[], filters: PartyFilters): T[] {
  const { status, roles, stateCodes, gst } = filters;
  const needle = filters.q?.toLowerCase();

  return parties.filter(
    (party) =>
      (!status || party.active === (status === "active")) &&
      (!roles || party.roles.some((role) => roles.includes(role))) &&
      (!stateCodes || stateCodes.includes(party.stateCode)) &&
      (!gst || (party.gstin !== null) === (gst === "registered")) &&
      (!needle ||
        [party.name, party.gstin, party.pan, party.email].some((field) =>
          field?.toLowerCase().includes(needle),
        ) ||
        party.phone?.includes(needle) === true),
  );
}

/** States in the whole master, not the filtered rows, so options stay while filtering. */
export function partyStateOptions(parties: { stateCode: string }[]) {
  return [...new Set(parties.map((party) => party.stateCode))]
    .map((code) => ({ code, name: INDIAN_STATES[code] ?? code }))
    .sort((left, right) => left.name.localeCompare(right.name));
}
