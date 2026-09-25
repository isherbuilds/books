import { searchQuery } from "@accly/api/lib/schemas";
import { Button } from "@accly/ui/components/button";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Outlet, createFileRoute, useMatch, useNavigate } from "@tanstack/react-router";
import { CircleDollarSignIcon, CircleDotIcon, ContactRoundIcon } from "lucide-react";
import { useRef } from "react";
import { z } from "zod";

import { DataTable } from "@/components/data-table/data-table";
import { TableEmpty } from "@/components/data-table/table-empty";
import { INVOICE_COLUMNS, InvoiceCard } from "@/components/invoice-columns";
import { DOCUMENT_STATE_LABELS } from "@/components/document-columns";
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
import { usePaletteActions } from "@/components/palette/use-palette-actions";
import { invoiceListOptions } from "@/lib/invoices";
import { useCan } from "@/lib/membership";
import { OPERATIONAL_INFINITE_REFETCH } from "@/lib/operational-query";
import { partyListOptions } from "@/lib/parties";

const INVOICE_STATES = ["draft", "posted", "cancelled"] as const;

const SETTLEMENT_FILTERS = ["open", "overdue"] as const;

const SETTLEMENT_FILTER_LABELS = { open: "Open", overdue: "Overdue" } as const;

const invoiceSearch = z.object({
  q: searchQuery.catch(undefined),
  partyId: z.uuid().optional().catch(undefined),
  state: z.enum(INVOICE_STATES).optional().catch(undefined),
  settlement: z.enum(SETTLEMENT_FILTERS).optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
});

type InvoiceFilters = z.infer<typeof invoiceSearch>;

// A closed submenu renders nothing, so the party master loads only once it opens.
export const Route = createFileRoute("/$orgSlug/invoices")({
  head: () => ({ meta: [{ title: "Invoices · Accly Books" }] }),
  validateSearch: invoiceSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    await queryClient.infiniteQuery(invoiceListOptions(orgSlug, deps)).catch(() => {});
  },
  component: InvoicesRoute,
});

function InvoicesRoute() {
  const { orgSlug } = Route.useParams();
  const filters = Route.useSearch();
  const { q, partyId, state, settlement, from, to } = filters;
  const navigate = useNavigate({ from: Route.fullPath });
  const field = useRef<HTMLDivElement>(null);
  const canPost = useCan(orgSlug, { invoice: ["post"] });
  const canReadParties = useCan(orgSlug, { party: ["read"] });

  const invoices = useInfiniteQuery({
    ...invoiceListOptions(orgSlug, filters),
    ...OPERATIONAL_INFINITE_REFETCH,
  });

  // The party chip needs a name; the master is cached and shared with the palette.
  const parties = useQuery({
    ...partyListOptions(orgSlug),
    enabled: canReadParties && partyId !== undefined,
  });

  const activeRowId = useMatch({ from: "/$orgSlug/invoices/$invoiceId", shouldThrow: false })
    ?.params.invoiceId;

  const rows = invoices.data?.pages.flatMap((page) => page.rows) ?? [];

  const setFilters = (patch: Partial<InvoiceFilters>) =>
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
    const party = parties.data?.find((candidate) => candidate.id === partyId);
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
      label: SETTLEMENT_FILTER_LABELS[settlement],
      remove: () => setFilters({ settlement: undefined }),
    });

  const openCreate = () => void navigate({ to: "/$orgSlug/invoices/new", params: { orgSlug } });

  usePaletteActions(
    canPost ? [{ id: "invoice:new", label: "New invoice", group: "action", run: openCreate }] : [],
  );

  const empty =
    q !== undefined || chips.length > 0 ? (
      <TableEmpty
        title="No invoices match"
        description="Try another search or clear the filters."
        action={
          <Button size="xs" variant="outline" onClick={clear}>
            Clear filters
          </Button>
        }
      />
    ) : (
      <TableEmpty
        title="No invoices yet"
        description="Draft and posted invoices appear here, newest first."
        action={
          canPost ? (
            <Button size="xs" variant="outline" onClick={openCreate}>
              New invoice
            </Button>
          ) : undefined
        }
      />
    );

  return (
    <>
      <PageHeader
        title="Invoices"
        action={canPost ? <Button onClick={openCreate}>New</Button> : undefined}
      />
      <PageBody>
        <ListToolbar>
          <SearchInput
            label="Search invoices"
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
                  options={INVOICE_STATES}
                  labels={DOCUMENT_STATE_LABELS}
                  value={state}
                  onChange={(next) => void setFilters({ state: next })}
                />
                <OptionFilter
                  icon={CircleDollarSignIcon}
                  label="Settlement"
                  options={SETTLEMENT_FILTERS}
                  labels={SETTLEMENT_FILTER_LABELS}
                  value={settlement}
                  onChange={(next) => void setFilters({ settlement: next })}
                />
              </FilterMenu>
            }
          />
          <FilterChips filters={chips} field={field} onClear={clear} />
        </ListToolbar>

        <DataTable
          columns={INVOICE_COLUMNS}
          data={rows}
          getRowId={(invoice) => invoice.id}
          meta={{ orgSlug }}
          rowLink={(invoice) => ({
            to: "/$orgSlug/invoices/$invoiceId",
            params: { orgSlug, invoiceId: invoice.id },
            search: (previous) => previous,
          })}
          renderCard={(invoice) => <InvoiceCard invoice={invoice} />}
          query={invoices}
          errorTitle="Could not load invoices"
          empty={empty}
          activeRowId={activeRowId}
        />
        <LoadMore query={invoices} shown={rows.length} />
        <Outlet />
      </PageBody>

      {date.popover}
    </>
  );
}
