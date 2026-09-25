import { searchQuery } from "@accly/api/lib/schemas";
import { Button } from "@accly/ui/components/button";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Outlet, createFileRoute, useMatch, useNavigate } from "@tanstack/react-router";
import { CircleDollarSignIcon, CircleDotIcon, ContactRoundIcon } from "lucide-react";
import { useRef } from "react";
import { z } from "zod";

import { BILL_COLUMNS, BillCard } from "@/components/bill-columns";
import { DOCUMENT_STATE_LABELS } from "@/components/document-columns";
import { DataTable } from "@/components/data-table/data-table";
import { TableEmpty } from "@/components/data-table/table-empty";
import { useDateRangeFilter } from "@/components/date-range-filter";
import {
  FilterChips,
  FilterMenu,
  FilterSubmenu,
  focusSearch,
  type ActiveFilter,
  OptionFilter,
} from "@/components/list-filter";
import { PartyFilterItems } from "@/components/party-filter-items";
import { ListToolbar, LoadMore, PageBody, PageHeader, SearchInput } from "@/components/page";
import { billListOptions } from "@/lib/bills";
import { useCan } from "@/lib/membership";
import { requireOrgPermission } from "@/lib/route-permission";
import { OPERATIONAL_INFINITE_REFETCH } from "@/lib/operational-query";
import { partyListOptions } from "@/lib/parties";

const BILL_STATES = ["draft", "posted", "cancelled"] as const;

const SETTLEMENT_FILTERS = ["open", "overdue"] as const;

const SETTLEMENT_LABELS = { open: "Open", overdue: "Overdue" } as const;

const billSearch = z.object({
  q: searchQuery.catch(undefined),
  partyId: z.uuid().optional().catch(undefined),
  state: z.enum(BILL_STATES).optional().catch(undefined),
  settlement: z.enum(SETTLEMENT_FILTERS).optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
});

type BillFilters = z.infer<typeof billSearch>;

export const Route = createFileRoute("/$orgSlug/bills")({
  head: () => ({ meta: [{ title: "Bills · Accly Books" }] }),
  validateSearch: billSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { bill: ["read"] });
    await queryClient.infiniteQuery(billListOptions(orgSlug, deps)).catch(() => {});
  },
  component: BillsRoute,
});

function BillsRoute() {
  const { orgSlug } = Route.useParams();
  const filters = Route.useSearch();
  const { q, partyId, state, settlement, from, to } = filters;
  const navigate = useNavigate({ from: Route.fullPath });
  const field = useRef<HTMLDivElement>(null);
  const canCreate = useCan(orgSlug, { bill: ["create"] });
  const canReadParties = useCan(orgSlug, { party: ["read"] });

  const bills = useInfiniteQuery({
    ...billListOptions(orgSlug, filters),
    ...OPERATIONAL_INFINITE_REFETCH,
  });

  const parties = useQuery({
    ...partyListOptions(orgSlug),
    enabled: canReadParties && partyId !== undefined,
  });

  const activeRowId = useMatch({ from: "/$orgSlug/bills/$billId", shouldThrow: false })?.params
    .billId;

  const rows = bills.data?.pages.flatMap((page) => page.rows) ?? [];

  const setFilters = (patch: Partial<BillFilters>) =>
    navigate({ replace: true, search: (previous) => ({ ...previous, ...patch }) });

  const date = useDateRangeFilter({ from, to }, field, (range) => setFilters(range));

  const clear = () => {
    focusSearch(field, { empty: true });
    void setFilters({
      q: undefined,
      partyId: undefined,
      state: undefined,
      settlement: undefined,
      from: undefined,
      to: undefined,
    });
  };

  const chips: ActiveFilter[] = [];

  if (partyId) {
    const party = parties.data?.rows.find((candidate) => candidate.id === partyId);
    chips.push({
      id: "partyId",
      name: "Party",
      label: party ? `Party: ${party.name}` : "One party",
      remove: () => setFilters({ partyId: undefined }),
    });
  }

  if (date.chip) chips.push(date.chip);

  if (state)
    chips.push({
      id: "state",
      name: "State",
      label: DOCUMENT_STATE_LABELS[state],
      remove: () => setFilters({ state: undefined }),
    });

  if (settlement)
    chips.push({
      id: "settlement",
      name: "Settlement",
      label: SETTLEMENT_LABELS[settlement],
      remove: () => setFilters({ settlement: undefined }),
    });

  const openCreate = () => void navigate({ to: "/$orgSlug/bills/new", params: { orgSlug } });

  const empty =
    q !== undefined || chips.length > 0 ? (
      <TableEmpty
        title="No bills match"
        description="Try another search or clear the filters."
        action={
          <Button size="xs" variant="outline" onClick={clear}>
            Clear filters
          </Button>
        }
      />
    ) : (
      <TableEmpty
        title="No bills yet"
        description="Draft and posted bills appear here, newest first."
      />
    );

  return (
    <>
      <PageHeader
        title="Bills"
        action={canCreate ? <Button onClick={openCreate}>New</Button> : undefined}
      />
      <PageBody>
        <ListToolbar>
          <SearchInput
            label="Search bills"
            placeholder="Number, party, or reference"
            value={q}
            fieldRef={field}
            onQueryChange={(next) => void setFilters({ q: next || undefined })}
            trailing={
              <FilterMenu anchor={field} active={chips.length > 0}>
                {date.submenu}
                {canReadParties ? (
                  <FilterSubmenu icon={ContactRoundIcon} label="Party">
                    <PartyFilterItems
                      orgSlug={orgSlug}
                      partyId={partyId}
                      onChange={(next) => void setFilters({ partyId: next })}
                    />
                  </FilterSubmenu>
                ) : null}
                <OptionFilter
                  icon={CircleDotIcon}
                  label="State"
                  options={BILL_STATES}
                  labels={DOCUMENT_STATE_LABELS}
                  value={state}
                  // Settlement lists posted documents only, so each filter clears a
                  // contradicting choice in the other.
                  onChange={(next) =>
                    void setFilters({
                      state: next,
                      settlement: next && next !== "posted" ? undefined : settlement,
                    })
                  }
                />
                <OptionFilter
                  icon={CircleDollarSignIcon}
                  label="Settlement"
                  options={SETTLEMENT_FILTERS}
                  labels={SETTLEMENT_LABELS}
                  value={settlement}
                  onChange={(next) =>
                    void setFilters({
                      settlement: next,
                      state: next && state !== "posted" ? undefined : state,
                    })
                  }
                />
              </FilterMenu>
            }
          />
          <FilterChips filters={chips} field={field} onClear={clear} />
        </ListToolbar>
        <DataTable
          columns={BILL_COLUMNS}
          data={rows}
          getRowId={(bill) => bill.id}
          meta={{ orgSlug }}
          rowLink={(bill) => ({
            to: "/$orgSlug/bills/$billId",
            params: { orgSlug, billId: bill.id },
            search: (previous) => previous,
          })}
          renderCard={(bill) => <BillCard bill={bill} />}
          query={bills}
          errorTitle="Could not load bills"
          empty={empty}
          activeRowId={activeRowId}
        />
        <LoadMore query={bills} shown={rows.length} />
        <Outlet />
      </PageBody>
      {date.popover}
    </>
  );
}
