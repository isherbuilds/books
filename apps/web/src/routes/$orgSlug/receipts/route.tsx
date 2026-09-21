import { searchQuery } from "@accly/api/lib/schemas";
import { authorize } from "@accly/auth/access";
import { Button } from "@accly/ui/components/button";
import { DropdownMenuCheckboxItem, DropdownMenuItem } from "@accly/ui/components/dropdown-menu";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Outlet, createFileRoute, useMatch, useNavigate } from "@tanstack/react-router";
import { ArrowLeftRightIcon, CalendarIcon, CircleDotIcon, WalletIcon } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";

import { DataTable } from "@/components/data-table/data-table";
import { TableEmpty } from "@/components/data-table/table-empty";
import {
  DateRangePopover,
  FilterChips,
  FilterMenu,
  FilterSubmenu,
  PresetItems,
  focusSearch,
  toggleValue,
  type ActiveFilter,
} from "@/components/list-filter";
import { ListToolbar, LoadMore, PageBody, PageHeader, SearchInput } from "@/components/page";
import { usePaletteActions } from "@/components/palette/use-palette-actions";
import { RECEIPT_COLUMNS, ReceiptCard } from "@/components/receipt-columns";
import { ReceiptOverlay } from "@/components/receipt-overlay";
import { rangeLabel, type SearchRange } from "@/lib/date-presets";
import { membershipOptions, useCan } from "@/lib/membership";
import { OPERATIONAL_INFINITE_REFETCH } from "@/lib/operational-query";
import { useOrgDateTime } from "@/lib/org-datetime";
import { partyListOptions } from "@/lib/parties";
import { paymentMethodListOptions, receiptListOptions } from "@/lib/receipts";

// Mirror receipt.list's enums, kept local so no server schema module reaches the
// client (hard rule 6). "against" joins once it can be posted.
const RECEIPT_STATES = ["posted", "cancelled"] as const;

const SETTLEMENT_KINDS = ["advance", "direct"] as const;

const STATE_LABELS = { posted: "Posted", cancelled: "Cancelled" } as const;

const SETTLEMENT_LABELS = { advance: "Advance", direct: "Direct" } as const;

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
  const { today, financialYearStart } = useOrgDateTime();
  const navigate = useNavigate({ from: Route.fullPath });
  const field = useRef<HTMLDivElement>(null);
  const range: SearchRange = { from, to };
  const rangeText = rangeLabel(range, today, financialYearStart);
  const newTrigger = useRef<HTMLButtonElement>(null);
  const [customRangeOpen, setCustomRangeOpen] = useState(false);
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

  const activeRowId = useMatch({ from: "/$orgSlug/receipts/$receiptId", shouldThrow: false })
    ?.params.receiptId;

  const rows = receipts.data?.pages.flatMap((page) => page.rows) ?? [];

  const setFilters = (patch: Partial<ReceiptFilters>) =>
    navigate({ replace: true, search: (previous) => ({ ...previous, ...patch }) });

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
    const party = parties.data?.find((each) => each.id === partyId);

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
      label: SETTLEMENT_LABELS[settlementKind],
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
        action={
          canPost ? (
            <Button size="xs" variant="outline" onClick={openCreate}>
              New receipt
            </Button>
          ) : undefined
        }
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
                <FilterSubmenu icon={CircleDotIcon} label="State">
                  {RECEIPT_STATES.map((each) => (
                    <DropdownMenuCheckboxItem
                      key={each}
                      checked={state === each}
                      onCheckedChange={(checked) =>
                        void setFilters({ state: checked ? each : undefined })
                      }
                    >
                      {STATE_LABELS[each]}
                    </DropdownMenuCheckboxItem>
                  ))}
                </FilterSubmenu>
                <FilterSubmenu icon={ArrowLeftRightIcon} label="Settlement">
                  {SETTLEMENT_KINDS.map((each) => (
                    <DropdownMenuCheckboxItem
                      key={each}
                      checked={settlementKind === each}
                      onCheckedChange={(checked) =>
                        void setFilters({ settlementKind: checked ? each : undefined })
                      }
                    >
                      {SETTLEMENT_LABELS[each]}
                    </DropdownMenuCheckboxItem>
                  ))}
                </FilterSubmenu>
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

      <DateRangePopover
        open={customRangeOpen}
        onOpenChange={setCustomRangeOpen}
        anchor={field}
        from={from}
        to={to}
        today={today}
        onApply={(next) => void setFilters(next)}
      />

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
