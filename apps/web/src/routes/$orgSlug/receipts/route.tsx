import { DOCUMENT_SEARCH_PATTERN, documentSearchQuery } from "@accly/api/lib/schemas";
import { SETTLEMENT_KINDS } from "@accly/db/schema/settlement-kinds";
import { authorize } from "@accly/auth/access";
import { Button } from "@accly/ui/components/button";
import { DropdownMenuCheckboxItem, DropdownMenuItem } from "@accly/ui/components/dropdown-menu";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Outlet, createFileRoute, useMatch, useNavigate } from "@tanstack/react-router";
import { ArrowLeftRightIcon, CircleDotIcon, WalletIcon } from "lucide-react";
import { useRef } from "react";
import { z } from "zod";

import { DataTable } from "@/components/data-table/data-table";
import { DOCUMENT_STATE_LABELS, SETTLEMENT_KIND_LABELS } from "@/components/document-columns";
import { RegisterEmpty } from "@/components/data-table/table-empty";
import { useDateRangeFilter } from "@/components/date-range-filter";
import {
  FilterChips,
  usePartyChip,
  FilterMenu,
  FilterSubmenu,
  focusSearch,
  toggleValue,
  type ActiveFilter,
  OptionFilter,
} from "@/components/list-filter";
import { ListToolbar, PageBody, PageHeader, SearchInput } from "@/components/page";
import { usePaletteActions } from "@/components/palette/use-palette-actions";
import { RECEIPT_COLUMNS, ReceiptCard } from "@/components/receipt-columns";
import { RegisterTotals } from "@/components/register-totals";
import { ReceiptOverlay } from "@/components/receipt-overlay";
import { WaveLoader } from "@/components/wave-loader";
import { useCan } from "@/lib/membership";
import { OPERATIONAL_INFINITE_REFETCH } from "@/lib/operational-query";
import { useOrgDateTime } from "@/lib/org-datetime";
import { paymentMethodListOptions, receiptListOptions, receiptTotalsOptions } from "@/lib/receipts";
import { partyDetailOptions } from "@/lib/parties";
import { periodSearch, requirePeriod } from "@/lib/require-period";
import { requireOrgPermission } from "@/lib/route-permission";

// A Receipt posts in full, so it is never a draft.
const RECEIPT_STATES = ["posted", "cancelled"] as const;

// URL keys equal receipt.list input keys, so no mapping layer exists.
const receiptSearch = z.object({
  create: z.boolean().optional().catch(undefined),
  payerId: z.uuid().optional().catch(undefined),
  refund: z.boolean().optional().catch(undefined),
  q: documentSearchQuery.catch(undefined),
  partyId: z.uuid().optional().catch(undefined),
  ...periodSearch,
  paymentMethodIds: z.array(z.uuid()).min(1).max(20).optional().catch(undefined),
  state: z.enum(RECEIPT_STATES).optional().catch(undefined),
  settlementKind: z.enum(SETTLEMENT_KINDS).optional().catch(undefined),
});

type ReceiptFilters = Omit<z.infer<typeof receiptSearch>, "create" | "payerId" | "refund">;

export const Route = createFileRoute("/$orgSlug/receipts")({
  head: () => ({ meta: [{ title: "Receipts · Accly Books" }] }),
  validateSearch: receiptSearch,
  beforeLoad: ({ context: { queryClient }, location, params: { orgSlug }, search }) =>
    requirePeriod(queryClient, orgSlug, location, search, "this-month"),
  // `create` stays out: opening the overlay must not refetch the list.
  loaderDeps: ({ search: { create, payerId, refund: _refund, all: _all, ...filters } }) => ({
    filters,
    payerId: create ? payerId : undefined,
  }),
  // The method master loads with the list, in one batch; awaited, so the server
  // renders the method chip the client hydrates.
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    const membership = await requireOrgPermission(queryClient, orgSlug, { receipt: ["read"] });

    await Promise.all([
      authorize(membership.roles, { paymentMethod: ["read"] }) &&
        queryClient.query(paymentMethodListOptions(orgSlug)).catch(() => {}),
      queryClient.infiniteQuery(receiptListOptions(orgSlug, deps.filters)).catch(() => {}),
      queryClient.prefetchQuery(receiptTotalsOptions(orgSlug, deps.filters)),
      deps.payerId
        ? queryClient.prefetchQuery(partyDetailOptions(orgSlug, deps.payerId)).catch(() => {})
        : undefined,
    ]);
  },
  component: ReceiptsRoute,
});

function ReceiptsRoute() {
  const { orgSlug } = Route.useParams();
  const { create, payerId, refund, all: _all, ...filters } = Route.useSearch();
  const { q, partyId, from, to, paymentMethodIds, state, settlementKind } = filters;
  const { today } = useOrgDateTime();
  const navigate = useNavigate({ from: Route.fullPath });
  const field = useRef<HTMLDivElement>(null);
  const newTrigger = useRef<HTMLButtonElement>(null);
  const canPost = useCan(orgSlug, { receipt: ["post"] });
  const canReadMethods = useCan(orgSlug, { paymentMethod: ["read"] });

  const receipts = useInfiniteQuery({
    ...receiptListOptions(orgSlug, filters),
    ...OPERATIONAL_INFINITE_REFETCH,
  });

  const totals = useQuery(receiptTotalsOptions(orgSlug, filters));

  // Every method, not only active ones: old receipts name retired methods.
  const methods = useQuery({ ...paymentMethodListOptions(orgSlug), enabled: canReadMethods });

  const activeRowId = useMatch({ from: "/$orgSlug/receipts/$receiptId", shouldThrow: false })
    ?.params.receiptId;

  const rows = receipts.data?.pages.flatMap((page) => page.rows) ?? [];

  const setFilters = (patch: Partial<ReceiptFilters>) =>
    navigate({ replace: true, search: (previous) => ({ ...previous, ...patch }) });

  const partyChip = usePartyChip(orgSlug, partyId, () => setFilters({ partyId: undefined }));

  const date = useDateRangeFilter({ from, to }, field, setFilters);

  // Both Clear buttons unmount once the filters go, so focus moves to the box first.
  const clear = () => {
    focusSearch(field, { empty: true });

    void navigate({ replace: true, search: { all: true } });
  };

  const chips: ActiveFilter[] = [];

  if (partyChip) chips.push(partyChip);

  if (date.chip) chips.push(date.chip);

  if (paymentMethodIds) {
    const names = paymentMethodIds.map(
      (id) => methods.data?.find((method) => method.id === id)?.name,
    );

    const count = paymentMethodIds.length;

    chips.push({
      id: "paymentMethodIds",
      name: "Payment method",
      label: names.every((name) => name !== undefined)
        ? names.join(", ")
        : `${count} payment method${count === 1 ? "" : "s"}`,
      remove: () => setFilters({ paymentMethodIds: undefined }),
    });
  }

  if (state) {
    chips.push({
      id: "state",
      name: "State",
      label: DOCUMENT_STATE_LABELS[state],
      remove: () => setFilters({ state: undefined }),
    });
  }

  if (settlementKind) {
    chips.push({
      id: "settlementKind",
      name: "Settlement",
      label: SETTLEMENT_KIND_LABELS[settlementKind],
      remove: () => setFilters({ settlementKind: undefined }),
    });
  }

  const openCreate = () => void navigate({ search: (previous) => ({ ...previous, create: true }) });

  usePaletteActions(
    canPost ? [{ id: "receipt:new", label: "New receipt", group: "action", run: openCreate }] : [],
  );

  const closeOverlay = () =>
    void navigate({
      replace: true,
      search: (previous) => ({
        ...previous,
        create: undefined,
        payerId: undefined,
        refund: undefined,
      }),
    }).then(() => newTrigger.current?.focus());

  const empty = (
    <RegisterEmpty
      noun="receipts"
      filtered={q !== undefined || chips.length > 0}
      onClear={clear}
      description="Posted receipts appear here, newest first."
    />
  );

  return (
    <>
      <PageHeader
        title="Receipts"
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
            pattern={DOCUMENT_SEARCH_PATTERN}
            label="Search receipts"
            placeholder="Number, party, or reference"
            value={q}
            fieldRef={field}
            onQueryChange={(next) => void setFilters({ q: next || undefined })}
            trailing={
              <FilterMenu anchor={field} active={chips.length > 0}>
                {date.submenu}
                {canReadMethods ? (
                  <FilterSubmenu icon={WalletIcon} label="Payment method">
                    {methods.data?.length ? (
                      methods.data.map((method) => (
                        <DropdownMenuCheckboxItem
                          key={method.id}
                          checked={paymentMethodIds?.includes(method.id) ?? false}
                          onCheckedChange={() =>
                            void setFilters({
                              paymentMethodIds: toggleValue(paymentMethodIds, method.id),
                            })
                          }
                        >
                          {method.name}
                          {method.active ? null : (
                            <span className="text-muted-foreground">(inactive)</span>
                          )}
                        </DropdownMenuCheckboxItem>
                      ))
                    ) : (
                      <DropdownMenuItem disabled>
                        {methods.isPending ? (
                          <WaveLoader label="Loading payment methods" />
                        ) : methods.isError ? (
                          "Could not load payment methods"
                        ) : (
                          "No payment methods"
                        )}
                      </DropdownMenuItem>
                    )}
                  </FilterSubmenu>
                ) : null}
                <OptionFilter
                  icon={CircleDotIcon}
                  label="State"
                  options={RECEIPT_STATES}
                  labels={DOCUMENT_STATE_LABELS}
                  value={state}
                  onChange={(next) => void setFilters({ state: next })}
                />
                <OptionFilter
                  icon={ArrowLeftRightIcon}
                  label="Settlement"
                  options={SETTLEMENT_KINDS}
                  labels={SETTLEMENT_KIND_LABELS}
                  value={settlementKind}
                  onChange={(next) => void setFilters({ settlementKind: next })}
                />
              </FilterMenu>
            }
          />
          <FilterChips filters={chips} field={field} onClear={clear} />
        </ListToolbar>

        <RegisterTotals query={totals} noun={filters.state ? "receipt" : "posted receipt"} />
        <DataTable
          columns={RECEIPT_COLUMNS}
          data={rows}
          getRowId={(receipt) => receipt.id}
          meta={{ orgSlug }}
          rowLink={(receipt) => ({
            to: "/$orgSlug/receipts/$receiptId",
            params: { orgSlug, receiptId: receipt.id },
            search: (previous) => ({ ...previous, create: undefined }),
          })}
          renderCard={(receipt) => <ReceiptCard receipt={receipt} />}
          query={receipts}
          errorTitle="Could not load receipts"
          empty={empty}
          activeRowId={activeRowId}
        />
        {/* The record Sheet opens over the list, which stays mounted. */}
        <Outlet />
      </PageBody>

      {date.popover}

      {canPost ? (
        <ReceiptOverlay
          key={`${payerId ?? ""}:${refund ?? ""}`}
          orgSlug={orgSlug}
          today={today}
          payerId={payerId}
          refund={refund}
          open={create === true}
          onClose={closeOverlay}
        />
      ) : null}
    </>
  );
}
