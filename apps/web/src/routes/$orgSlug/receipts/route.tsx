import { searchQuery } from "@accly/api/lib/schemas";
import { SETTLEMENT_KINDS } from "@accly/db/schema/settlement-kinds";
import { authorize } from "@accly/auth/access";
import { Button } from "@accly/ui/components/button";
import { DropdownMenuCheckboxItem, DropdownMenuItem } from "@accly/ui/components/dropdown-menu";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Outlet, createFileRoute, useMatch, useNavigate } from "@tanstack/react-router";
import { ArrowLeftRightIcon, CircleDotIcon, ContactRoundIcon, WalletIcon } from "lucide-react";
import { useRef } from "react";
import { z } from "zod";

import { DataTable } from "@/components/data-table/data-table";
import { SETTLEMENT_KIND_LABELS } from "@/components/document-columns";
import { TableEmpty } from "@/components/data-table/table-empty";
import { useDateRangeFilter } from "@/components/date-range-filter";
import {
  FilterChips,
  FilterMenu,
  FilterSubmenu,
  focusSearch,
  toggleValue,
  type ActiveFilter,
  OptionFilter,
} from "@/components/list-filter";
import { ListToolbar, LoadMore, PageBody, PageHeader, SearchInput } from "@/components/page";
import { usePaletteActions } from "@/components/palette/use-palette-actions";
import { PartyFilterItems } from "@/components/party-filter-items";
import { RECEIPT_COLUMNS, ReceiptCard } from "@/components/receipt-columns";
import { ReceiptOverlay } from "@/components/receipt-overlay";
import { membershipOptions, useCan } from "@/lib/membership";
import { OPERATIONAL_INFINITE_REFETCH } from "@/lib/operational-query";
import { useOrgDateTime } from "@/lib/org-datetime";
import { partyListOptions, usePartyName } from "@/lib/parties";
import { paymentMethodListOptions, receiptListOptions } from "@/lib/receipts";

// A Receipt posts in full, so it is never a draft.
const RECEIPT_STATES = ["posted", "cancelled"] as const;

const STATE_LABELS = { posted: "Posted", cancelled: "Cancelled" } as const;

// URL keys equal receipt.list input keys, so no mapping layer exists.
const receiptSearch = z.object({
  create: z.boolean().optional().catch(undefined),
  q: searchQuery.catch(undefined),
  partyId: z.uuid().optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  paymentMethodIds: z.array(z.uuid()).min(1).max(20).optional().catch(undefined),
  state: z.enum(RECEIPT_STATES).optional().catch(undefined),
  settlementKind: z.enum(SETTLEMENT_KINDS).optional().catch(undefined),
});

type ReceiptFilters = Omit<z.infer<typeof receiptSearch>, "create">;

export const Route = createFileRoute("/$orgSlug/receipts")({
  head: () => ({ meta: [{ title: "Receipts · Accly Books" }] }),
  validateSearch: receiptSearch,
  // `create` stays out: opening the overlay must not refetch the list.
  loaderDeps: ({ search: { create: _create, ...filters } }) => filters,
  // The method master starts here, not after mount, so it rides the list's batch
  // instead of a second round trip. Only the list blocks the page.
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    const membership = await queryClient.query(membershipOptions(orgSlug));

    if (authorize(membership.roles, { paymentMethod: ["read"] })) {
      void queryClient.query(paymentMethodListOptions(orgSlug)).catch(() => {});
    }

    await queryClient.infiniteQuery(receiptListOptions(orgSlug, deps)).catch(() => {});
  },
  component: ReceiptsRoute,
});

function ReceiptsRoute() {
  const { orgSlug } = Route.useParams();
  const { create, ...filters } = Route.useSearch();
  const { q, partyId, from, to, paymentMethodIds, state, settlementKind } = filters;
  const { today } = useOrgDateTime();
  const navigate = useNavigate({ from: Route.fullPath });
  const field = useRef<HTMLDivElement>(null);
  const newTrigger = useRef<HTMLButtonElement>(null);
  const canPost = useCan(orgSlug, { receipt: ["post"] });
  const canReadMethods = useCan(orgSlug, { paymentMethod: ["read"] });
  const canReadParties = useCan(orgSlug, { party: ["read"] });

  const receipts = useInfiniteQuery({
    ...receiptListOptions(orgSlug, filters),
    ...OPERATIONAL_INFINITE_REFETCH,
  });

  // Every method, not only active ones: old receipts name retired methods.
  const methods = useQuery({ ...paymentMethodListOptions(orgSlug), enabled: canReadMethods });

  // The party chip needs a name; the master is cached and shared with the palette.
  const parties = useQuery({
    ...partyListOptions(orgSlug),
    enabled: canReadParties && partyId !== undefined,
  });

  const partyName = usePartyName(orgSlug, partyId, parties.data?.rows);

  const activeRowId = useMatch({ from: "/$orgSlug/receipts/$receiptId", shouldThrow: false })
    ?.params.receiptId;

  const rows = receipts.data?.pages.flatMap((page) => page.rows) ?? [];

  const setFilters = (patch: Partial<ReceiptFilters>) =>
    navigate({ replace: true, search: (previous) => ({ ...previous, ...patch }) });

  const date = useDateRangeFilter({ from, to }, field, (range) => setFilters(range));

  // Both Clear buttons unmount once the filters go, so focus moves to the box first.
  const clear = () => {
    focusSearch(field, { empty: true });

    void setFilters({
      q: undefined,
      partyId: undefined,
      from: undefined,
      to: undefined,
      paymentMethodIds: undefined,
      state: undefined,
      settlementKind: undefined,
    });
  };

  const chips: ActiveFilter[] = [];

  if (partyId) {
    chips.push({
      id: "partyId",
      name: "Party",
      label: partyName ? `Party: ${partyName}` : "One party",
      remove: () => setFilters({ partyId: undefined }),
    });
  }

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
      label: STATE_LABELS[state],
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
      search: (previous) => ({ ...previous, create: undefined }),
    }).then(() => newTrigger.current?.focus());

  const empty =
    q !== undefined || chips.length > 0 ? (
      <TableEmpty
        title="No receipts match"
        description="Try another search or clear the filters."
        action={
          <Button size="xs" variant="outline" onClick={clear}>
            Clear filters
          </Button>
        }
      />
    ) : (
      <TableEmpty
        title="No receipts yet"
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
            label="Search receipts"
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
                        {methods.isPending
                          ? "Loading…"
                          : methods.isError
                            ? "Could not load payment methods"
                            : "No payment methods"}
                      </DropdownMenuItem>
                    )}
                  </FilterSubmenu>
                ) : null}
                <OptionFilter
                  icon={CircleDotIcon}
                  label="State"
                  options={RECEIPT_STATES}
                  labels={STATE_LABELS}
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
        <LoadMore query={receipts} shown={rows.length} />
        {/* The record Sheet opens over the list, which stays mounted. */}
        <Outlet />
      </PageBody>

      {date.popover}

      {canPost ? (
        <ReceiptOverlay
          orgSlug={orgSlug}
          today={today}
          open={create === true}
          onClose={closeOverlay}
        />
      ) : null}
    </>
  );
}
