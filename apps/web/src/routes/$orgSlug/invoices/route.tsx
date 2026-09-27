import { searchQuery } from "@accly/api/lib/schemas";
import { Button } from "@accly/ui/components/button";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Outlet, createFileRoute, useMatch, useNavigate } from "@tanstack/react-router";
import { CircleDotIcon } from "lucide-react";
import { useRef } from "react";
import { z } from "zod";

import { DataTable } from "@/components/data-table/data-table";
import { RegisterEmpty } from "@/components/data-table/table-empty";
import { INVOICE_COLUMNS, InvoiceCard } from "@/components/invoice-columns";
import { DOCUMENT_STATE_LABELS } from "@/components/document-columns";
import { useDateRangeFilter } from "@/components/date-range-filter";
import {
  FilterChips,
  usePartyChip,
  FilterMenu,
  focusSearch,
  type ActiveFilter,
  OptionFilter,
} from "@/components/list-filter";
import { ListToolbar, LoadMore, PageBody, PageHeader, SearchInput } from "@/components/page";
import { invoiceListOptions } from "@/lib/invoices";
import { useCan } from "@/lib/membership";
import { OPERATIONAL_INFINITE_REFETCH } from "@/lib/operational-query";
import { periodSearch, requirePeriod } from "@/lib/require-period";
import { requireOrgPermission } from "@/lib/route-permission";

const STATUSES = ["draft", "posted", "cancelled", "open", "overdue"] as const;

const STATUS_LABELS = { ...DOCUMENT_STATE_LABELS, open: "Open", overdue: "Overdue" };

const invoiceSearch = z.object({
  q: searchQuery.catch(undefined),
  partyId: z.uuid().optional().catch(undefined),
  status: z.enum(STATUSES).optional().catch(undefined),
  ...periodSearch,
});

type InvoiceFilters = z.infer<typeof invoiceSearch>;

export const Route = createFileRoute("/$orgSlug/invoices")({
  head: () => ({ meta: [{ title: "Invoices · Accly Books" }] }),
  validateSearch: invoiceSearch,
  beforeLoad: ({ context: { queryClient }, location, params: { orgSlug }, search }) =>
    requirePeriod(queryClient, orgSlug, location, search, "this-month"),
  loaderDeps: ({ search: { all: _all, ...filters } }) => filters,
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { invoice: ["read"] });
    await queryClient.prefetchInfiniteQuery(invoiceListOptions(orgSlug, deps));
  },
  component: InvoicesRoute,
});

function InvoicesRoute() {
  const { orgSlug } = Route.useParams();
  const { all: _all, ...filters } = Route.useSearch();
  const { q, partyId, status, from, to } = filters;
  const navigate = useNavigate({ from: Route.fullPath });
  const field = useRef<HTMLDivElement>(null);
  const canCreate = useCan(orgSlug, { invoice: ["create"] });

  const invoices = useInfiniteQuery({
    ...invoiceListOptions(orgSlug, filters),
    ...OPERATIONAL_INFINITE_REFETCH,
  });

  const activeRowId = useMatch({ from: "/$orgSlug/invoices/$invoiceId", shouldThrow: false })
    ?.params.invoiceId;

  const rows = invoices.data?.pages.flatMap((page) => page.rows) ?? [];

  const setFilters = (patch: Partial<InvoiceFilters>) =>
    navigate({ replace: true, search: (previous) => ({ ...previous, ...patch }) });

  const partyChip = usePartyChip(orgSlug, partyId, () => setFilters({ partyId: undefined }));

  const date = useDateRangeFilter({ from, to }, field, (range) => setFilters(range));

  const clear = () => {
    focusSearch(field, { empty: true });
    void navigate({ replace: true, search: { all: true } });
  };

  const chips: ActiveFilter[] = [];

  if (partyChip) chips.push(partyChip);

  if (date.chip) chips.push(date.chip);

  if (status)
    chips.push({
      id: "status",
      name: "Status",
      label: STATUS_LABELS[status],
      remove: () => setFilters({ status: undefined }),
    });

  const openCreate = () => void navigate({ to: "/$orgSlug/invoices/new", params: { orgSlug } });

  const empty = (
    <RegisterEmpty
      noun="invoices"
      filtered={q !== undefined || chips.length > 0}
      onClear={clear}
      description="Draft and posted invoices appear here, newest first."
    />
  );

  return (
    <>
      <PageHeader
        title="Invoices"
        action={canCreate ? <Button onClick={openCreate}>New</Button> : undefined}
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
                <OptionFilter
                  icon={CircleDotIcon}
                  label="Status"
                  options={STATUSES}
                  labels={STATUS_LABELS}
                  value={status}
                  onChange={(next) => void setFilters({ status: next })}
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
