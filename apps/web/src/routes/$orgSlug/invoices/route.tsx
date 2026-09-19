import { formatMoney } from "@accly/api/core/money";
import { Button } from "@accly/ui/components/button";
import { DropdownMenuCheckboxItem, DropdownMenuItem } from "@accly/ui/components/dropdown-menu";
import { cn } from "@accly/ui/lib/utils";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { Outlet, createFileRoute, useMatch, useNavigate } from "@tanstack/react-router";
import { CalendarIcon, CircleDollarSignIcon, CircleDotIcon, ContactRoundIcon } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";

import { DataTable, DATA_TABLE_FEATURES, TextOrDash } from "@/components/data-table/data-table";
import { TableEmpty } from "@/components/data-table/table-empty";
import { InvoiceSheet } from "@/components/invoice-form";
import { INVOICE_STATE_LABELS, InvoiceStatus } from "@/components/invoice-summary";
import {
  DateRangePopover,
  FilterChips,
  FilterMenu,
  FilterSubmenu,
  PresetItems,
  focusSearch,
  type ActiveFilter,
} from "@/components/list-filter";
import { ListToolbar, LoadMore, PageBody, PageHeader, SearchInput } from "@/components/page";
import { usePaletteActions } from "@/components/palette/use-palette-actions";
import { rangeLabel, type SearchRange } from "@/lib/date-presets";
import { invoiceListOptions, type InvoiceListRow } from "@/lib/invoices";
import { useCan } from "@/lib/membership";
import { OPERATIONAL_INFINITE_REFETCH } from "@/lib/operational-query";
import { formatDay, useOrgDateTime } from "@/lib/org-datetime";
import { partyListOptions } from "@/lib/parties";

const INVOICE_STATES = ["draft", "posted", "cancelled"] as const;

const SETTLEMENT_FILTERS = ["open", "overdue"] as const;

const SETTLEMENT_FILTER_LABELS = { open: "Open", overdue: "Overdue" } as const;

const invoiceSearch = z.object({
  create: z.boolean().optional().catch(undefined),
  q: z.string().trim().min(1).max(100).optional().catch(undefined),
  partyId: z.uuid().optional().catch(undefined),
  state: z.enum(INVOICE_STATES).optional().catch(undefined),
  settlement: z.enum(SETTLEMENT_FILTERS).optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
});

type InvoiceFilters = Omit<z.infer<typeof invoiceSearch>, "create">;

const column = createColumnHelper<typeof DATA_TABLE_FEATURES, InvoiceListRow>();

const INVOICE_COLUMNS = [
  column.accessor("number", {
    header: "Number",
    meta: { className: "w-44" },
    cell: ({ row: { original: invoice } }) => (
      <span
        className={cn(
          "font-mono",
          invoice.state === "cancelled" && "text-muted-foreground line-through",
        )}
      >
        {invoice.number ?? "Draft"}
      </span>
    ),
  }),
  column.accessor("documentDate", {
    header: "Date",
    meta: { className: "w-24" },
    cell: ({ getValue }) => <span className="tabular-nums">{formatDay(getValue())}</span>,
  }),
  column.accessor("dueDate", {
    header: "Due date",
    meta: { className: "hidden w-24 lg:table-cell" },
    cell: ({ getValue }) => {
      const dueDate = getValue();

      return <span className="tabular-nums">{dueDate ? formatDay(dueDate) : "—"}</span>;
    },
  }),
  column.accessor("partyName", {
    header: "Party",
    cell: ({ getValue }) => <TextOrDash value={getValue()} />,
  }),
  column.accessor("reference", {
    header: "Reference",
    meta: { className: "hidden w-36 xl:table-cell" },
    cell: ({ getValue }) => <TextOrDash value={getValue()} />,
  }),
  column.display({
    id: "status",
    header: "Status",
    meta: { className: "w-44" },
    cell: ({ row: { original: invoice } }) => <InvoiceStatus invoice={invoice} />,
  }),
  column.accessor("totalPaise", {
    header: "Total",
    meta: { align: "right", className: "w-32" },
    cell: ({ row: { original: invoice } }) => (
      <span
        className={cn(
          "tabular-nums",
          invoice.state === "cancelled" && "text-muted-foreground line-through",
        )}
      >
        {formatMoney(invoice.totalPaise)}
      </span>
    ),
  }),
];

function InvoiceCard({ invoice }: { invoice: InvoiceListRow }) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            className={cn(
              "font-mono font-medium",
              invoice.state === "cancelled" && "text-muted-foreground line-through",
            )}
          >
            {invoice.number ?? "Draft"}
          </span>
          <InvoiceStatus invoice={invoice} />
        </span>
        <span
          className={cn(
            "shrink-0 tabular-nums",
            invoice.state === "cancelled" && "text-muted-foreground line-through",
          )}
        >
          {formatMoney(invoice.totalPaise)}
        </span>
      </div>
      <p className="mt-1 truncate text-muted-foreground">
        {invoice.partyName ?? "No party"} · {formatDay(invoice.documentDate)}
        {invoice.dueDate ? ` · Due ${formatDay(invoice.dueDate)}` : ""}
      </p>
    </>
  );
}

// A closed submenu renders nothing, so the party master loads only once it opens.
function PartyFilterItems({
  orgSlug,
  partyId,
  onChange,
}: {
  orgSlug: string;
  partyId: string | undefined;
  onChange: (partyId: string | undefined) => void;
}) {
  const parties = useQuery(partyListOptions(orgSlug));

  if (!parties.data?.length) {
    return (
      <DropdownMenuItem disabled>
        {parties.isPending ? "Loading…" : parties.isError ? "Could not load parties" : "No parties"}
      </DropdownMenuItem>
    );
  }

  return parties.data.map((party) => (
    <DropdownMenuCheckboxItem
      key={party.id}
      checked={partyId === party.id}
      onCheckedChange={(checked) => onChange(checked ? party.id : undefined)}
    >
      {party.name}
    </DropdownMenuCheckboxItem>
  ));
}

export const Route = createFileRoute("/$orgSlug/invoices")({
  head: () => ({ meta: [{ title: "Invoices · Accly Books" }] }),
  validateSearch: invoiceSearch,
  // `create` stays out: opening the overlay must not refetch the list.
  loaderDeps: ({ search: { create: _create, ...filters } }) => filters,
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    await queryClient.infiniteQuery(invoiceListOptions(orgSlug, deps)).catch(() => {});
  },
  component: InvoicesRoute,
});

function InvoicesRoute() {
  const { orgSlug } = Route.useParams();
  const { create, ...filters } = Route.useSearch();
  const { q, partyId, state, settlement, from, to } = filters;
  const { today, financialYearStart } = useOrgDateTime();
  const navigate = useNavigate({ from: Route.fullPath });
  const field = useRef<HTMLDivElement>(null);
  const range: SearchRange = { from, to };
  const rangeText = rangeLabel(range, today, financialYearStart);
  const newTrigger = useRef<HTMLButtonElement>(null);
  const [customRangeOpen, setCustomRangeOpen] = useState(false);
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

  if (from || to) {
    chips.push({
      id: "date",
      name: "Date",
      label: rangeText,
      remove: () => setFilters({ from: undefined, to: undefined }),
    });
  }

  if (state)
    chips.push({
      id: "state",
      name: "State",
      label: INVOICE_STATE_LABELS[state],
      remove: () => setFilters({ state: undefined }),
    });

  if (settlement)
    chips.push({
      id: "settlement",
      name: "Settlement",
      label: SETTLEMENT_FILTER_LABELS[settlement],
      remove: () => setFilters({ settlement: undefined }),
    });

  const openCreate = () => void navigate({ search: (previous) => ({ ...previous, create: true }) });

  usePaletteActions(
    canPost ? [{ id: "invoice:new", label: "New invoice", group: "action", run: openCreate }] : [],
  );

  const closeCreate = () =>
    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, create: undefined }),
    }).then(() => newTrigger.current?.focus());

  const openInvoice = (invoiceId: string, edit?: true) =>
    void navigate({
      to: "/$orgSlug/invoices/$invoiceId",
      params: { orgSlug, invoiceId },
      search: (previous) => ({ ...previous, create: undefined, edit }),
      replace: true,
    });

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
        action={
          canPost ? (
            <Button ref={newTrigger} onClick={openCreate}>
              New
            </Button>
          ) : undefined
        }
      />
      <PageBody>
        <ListToolbar>
          <SearchInput
            label="Search invoices"
            placeholder="Search number, party, or reference"
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
                  <FilterSubmenu icon={ContactRoundIcon} label="Party">
                    <PartyFilterItems
                      orgSlug={orgSlug}
                      partyId={partyId}
                      onChange={(next) => void setFilters({ partyId: next })}
                    />
                  </FilterSubmenu>
                ) : null}
                <FilterSubmenu icon={CircleDotIcon} label="State">
                  {INVOICE_STATES.map((candidate) => (
                    <DropdownMenuCheckboxItem
                      key={candidate}
                      checked={state === candidate}
                      onCheckedChange={(checked) =>
                        void setFilters({ state: checked ? candidate : undefined })
                      }
                    >
                      {INVOICE_STATE_LABELS[candidate]}
                    </DropdownMenuCheckboxItem>
                  ))}
                </FilterSubmenu>
                <FilterSubmenu icon={CircleDollarSignIcon} label="Settlement">
                  {SETTLEMENT_FILTERS.map((candidate) => (
                    <DropdownMenuCheckboxItem
                      key={candidate}
                      checked={settlement === candidate}
                      onCheckedChange={(checked) =>
                        void setFilters({ settlement: checked ? candidate : undefined })
                      }
                    >
                      {SETTLEMENT_FILTER_LABELS[candidate]}
                    </DropdownMenuCheckboxItem>
                  ))}
                </FilterSubmenu>
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
            search: (previous) => ({ ...previous, create: undefined }),
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

      <DateRangePopover
        open={customRangeOpen}
        onOpenChange={setCustomRangeOpen}
        anchor={field}
        from={from}
        to={to}
        today={today}
        onApply={(next) => void setFilters(next)}
      />

      {canPost && create ? (
        <InvoiceSheet
          orgSlug={orgSlug}
          today={today}
          onClose={closeCreate}
          // The saved draft reopens in its own editor, so a reload keeps it.
          onSaved={(invoiceId) => openInvoice(invoiceId, true)}
          onPosted={(invoiceId) => openInvoice(invoiceId)}
        />
      ) : null}
    </>
  );
}
