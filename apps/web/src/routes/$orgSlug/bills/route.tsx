import { searchQuery } from "@accly/api/lib/schemas";
import { Button } from "@accly/ui/components/button";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Outlet, createFileRoute, useMatch, useNavigate } from "@tanstack/react-router";
import { CircleDotIcon } from "lucide-react";
import { useRef } from "react";
import { z } from "zod";

import { BILL_COLUMNS, BillCard } from "@/components/bill-columns";
import { DOCUMENT_STATE_LABELS } from "@/components/document-columns";
import { DataTable } from "@/components/data-table/data-table";
import { RegisterEmpty } from "@/components/data-table/table-empty";
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
import { billListOptions } from "@/lib/bills";
import { useCan } from "@/lib/membership";
import { requireOrgPermission } from "@/lib/route-permission";
import { OPERATIONAL_INFINITE_REFETCH } from "@/lib/operational-query";
import { periodSearch, requirePeriod } from "@/lib/require-period";

const STATUSES = ["draft", "posted", "cancelled", "open", "overdue"] as const;

const STATUS_LABELS = { ...DOCUMENT_STATE_LABELS, open: "Open", overdue: "Overdue" };

const billSearch = z.object({
  q: searchQuery.catch(undefined),
  partyId: z.uuid().optional().catch(undefined),
  status: z.enum(STATUSES).optional().catch(undefined),
  ...periodSearch,
});

type BillFilters = z.infer<typeof billSearch>;

export const Route = createFileRoute("/$orgSlug/bills")({
  head: () => ({ meta: [{ title: "Bills · Accly Books" }] }),
  validateSearch: billSearch,
  beforeLoad: ({ context: { queryClient }, location, params: { orgSlug }, search }) =>
    requirePeriod(queryClient, orgSlug, location, search, "this-month"),
  loaderDeps: ({ search: { all: _all, ...filters } }) => filters,
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { bill: ["read"] });
    await queryClient.prefetchInfiniteQuery(billListOptions(orgSlug, deps));
  },
  component: BillsRoute,
});

function BillsRoute() {
  const { orgSlug } = Route.useParams();
  const { all: _all, ...filters } = Route.useSearch();
  const { q, partyId, status, from, to } = filters;
  const navigate = useNavigate({ from: Route.fullPath });
  const field = useRef<HTMLDivElement>(null);
  const canCreate = useCan(orgSlug, { bill: ["create"] });

  const bills = useInfiniteQuery({
    ...billListOptions(orgSlug, filters),
    ...OPERATIONAL_INFINITE_REFETCH,
  });

  const activeRowId = useMatch({ from: "/$orgSlug/bills/$billId", shouldThrow: false })?.params
    .billId;

  const rows = bills.data?.pages.flatMap((page) => page.rows) ?? [];

  const setFilters = (patch: Partial<BillFilters>) =>
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

  const openCreate = () => void navigate({ to: "/$orgSlug/bills/new", params: { orgSlug } });

  const empty = (
    <RegisterEmpty
      noun="bills"
      filtered={q !== undefined || chips.length > 0}
      onClear={clear}
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
