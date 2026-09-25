import { searchQuery } from "@accly/api/lib/schemas";
import { Button } from "@accly/ui/components/button";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Outlet, createFileRoute, useMatch, useNavigate } from "@tanstack/react-router";
import { CalendarIcon, CircleDollarSignIcon, CircleDotIcon, ContactRoundIcon } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";

import { BILL_COLUMNS, BillCard } from "@/components/bill-columns";
import { DOCUMENT_STATE_LABELS } from "@/components/document-columns";
import { DataTable } from "@/components/data-table/data-table";
import { TableEmpty } from "@/components/data-table/table-empty";
import { DateRangePopover, PresetItems } from "@/components/date-range-filter";
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
import { usePaletteActions } from "@/components/palette/use-palette-actions";
import { billListOptions } from "@/lib/bills";
import { rangeLabel, type SearchRange } from "@/lib/date-presets";
import { useCan } from "@/lib/membership";
import { OPERATIONAL_INFINITE_REFETCH } from "@/lib/operational-query";
import { useOrgDateTime } from "@/lib/org-datetime";
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
    await queryClient.infiniteQuery(billListOptions(orgSlug, deps)).catch(() => {});
  },
  component: BillsRoute,
});

function BillsRoute() {
  const { orgSlug } = Route.useParams();
  const filters = Route.useSearch();
  const { q, partyId, state, settlement, from, to } = filters;
  const { today, financialYearStart } = useOrgDateTime();
  const navigate = useNavigate({ from: Route.fullPath });
  const field = useRef<HTMLDivElement>(null);
  const range: SearchRange = { from, to };
  const rangeText = rangeLabel(range, today, financialYearStart);
  const [customRangeOpen, setCustomRangeOpen] = useState(false);
  const canPost = useCan(orgSlug, { bill: ["post"] });
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
    const party = parties.data?.find((candidate) => candidate.id === partyId);
    chips.push({
      id: "partyId",
      name: "Supplier",
      label: party ? `Supplier: ${party.name}` : "One supplier",
      remove: () => setFilters({ partyId: undefined }),
    });
  }

  if (from || to)
    chips.push({
      id: "date",
      name: "Date",
      label: rangeText,
      remove: () => setFilters({ from: undefined, to: undefined }),
    });

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
  usePaletteActions(
    canPost ? [{ id: "bill:new", label: "New bill", group: "action", run: openCreate }] : [],
  );

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
        action={
          canPost ? (
            <Button size="xs" variant="outline" onClick={openCreate}>
              New bill
            </Button>
          ) : undefined
        }
      />
    );

  return (
    <>
      <PageHeader
        title="Bills"
        action={canPost ? <Button onClick={openCreate}>New</Button> : undefined}
      />
      <PageBody>
        <ListToolbar>
          <SearchInput
            label="Search bills"
            placeholder="Bill, supplier, or reference"
            value={q}
            fieldRef={field}
            onQueryChange={(next) => void setFilters({ q: next || undefined })}
            trailing={
              <FilterMenu anchor={field} active={chips.length > 0}>
                <FilterSubmenu icon={CalendarIcon} label={rangeText}>
                  <PresetItems
                    range={range}
                    today={today}
                    financialYearStart={financialYearStart}
                    onSelect={(next) => void setFilters(next)}
                    onCustom={() => setCustomRangeOpen(true)}
                  />
                </FilterSubmenu>
                {canReadParties ? (
                  <FilterSubmenu icon={ContactRoundIcon} label="Supplier">
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
                  onChange={(next) => void setFilters({ state: next })}
                />
                <OptionFilter
                  icon={CircleDollarSignIcon}
                  label="Settlement"
                  options={SETTLEMENT_FILTERS}
                  labels={SETTLEMENT_LABELS}
                  value={settlement}
                  onChange={(next) => void setFilters({ settlement: next })}
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
      <DateRangePopover
        open={customRangeOpen}
        onOpenChange={setCustomRangeOpen}
        anchor={field}
        from={from}
        to={to}
        today={today}
        onApply={(next) => void setFilters(next)}
      />
    </>
  );
}
