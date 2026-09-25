import { searchQuery } from "@accly/api/lib/schemas";
import { SETTLEMENT_KINDS } from "@accly/db/schema/settlement-kinds";
import { Button } from "@accly/ui/components/button";
import { DropdownMenuCheckboxItem } from "@accly/ui/components/dropdown-menu";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Outlet, createFileRoute, useMatch, useNavigate } from "@tanstack/react-router";
import { ArrowLeftRightIcon, CircleDotIcon } from "lucide-react";
import { useRef } from "react";
import { useIsMutating } from "@tanstack/react-query";
import { z } from "zod";

import { DataTable } from "@/components/data-table/data-table";
import { TableEmpty } from "@/components/data-table/table-empty";
import { FormSheet } from "@/components/form-sheet";
import { useDateRangeFilter } from "@/components/date-range-filter";
import {
  FilterChips,
  FilterMenu,
  FilterSubmenu,
  focusSearch,
  type ActiveFilter,
  OptionFilter,
} from "@/components/list-filter";
import { ListToolbar, LoadMore, PageBody, PageHeader, SearchInput } from "@/components/page";
import { usePaletteActions } from "@/components/palette/use-palette-actions";
import { PAYMENT_COLUMNS, PaymentCard } from "@/components/payment-columns";
import { PaymentForm } from "@/components/payment-form";
import { useCan } from "@/lib/membership";
import { OPERATIONAL_INFINITE_REFETCH } from "@/lib/operational-query";
import { useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { partyListOptions, usePartyName } from "@/lib/parties";
import { paymentListOptions } from "@/lib/payments";

const STATES = ["posted", "cancelled"] as const;

const LABELS = { against: "Against", advance: "Advance", direct: "Direct" } as const;

const paymentSearch = z.object({
  create: z.boolean().optional().catch(undefined),
  // Seeds the new payment's party; kept apart from the `partyId` list filter.
  payeeId: z.uuid().optional().catch(undefined),
  q: searchQuery.catch(undefined),
  partyId: z.uuid().optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  state: z.enum(STATES).optional().catch(undefined),
  settlementKind: z.enum(SETTLEMENT_KINDS).optional().catch(undefined),
});

type Filters = Omit<z.infer<typeof paymentSearch>, "create" | "payeeId">;

export const Route = createFileRoute("/$orgSlug/payments")({
  head: () => ({ meta: [{ title: "Payments · Accly Books" }] }),
  validateSearch: paymentSearch,
  loaderDeps: ({ search: { create: _create, payeeId: _payeeId, ...filters } }) => filters,
  loader: async ({ context: { queryClient }, params: { orgSlug }, deps }) => {
    await queryClient.infiniteQuery(paymentListOptions(orgSlug, deps)).catch(() => {});
  },
  component: PaymentsRoute,
});

function PaymentOverlay({
  orgSlug,
  today,
  partyId,
  onClose,
}: {
  orgSlug: string;
  today: string;
  partyId?: string;
  onClose: () => void;
}) {
  const saving = useIsMutating({ mutationKey: orpc.payment.post.mutationKey() }) > 0;

  return (
    <FormSheet
      open
      onClose={onClose}
      saving={saving}
      title="New payment"
      description="Record money paid by the organization."
    >
      <PaymentForm orgSlug={orgSlug} today={today} initialPartyId={partyId} onClose={onClose} />
    </FormSheet>
  );
}

function PaymentsRoute() {
  const { orgSlug } = Route.useParams();
  const { create, payeeId, ...filters } = Route.useSearch();
  const { q, partyId, from, to, state, settlementKind } = filters;
  const { today } = useOrgDateTime();
  const navigate = useNavigate({ from: Route.fullPath });
  const field = useRef<HTMLDivElement>(null);
  const newTrigger = useRef<HTMLButtonElement>(null);
  const canPost = useCan(orgSlug, { payment: ["post"] });
  const canReadParties = useCan(orgSlug, { party: ["read"] });

  const payments = useInfiniteQuery({
    ...paymentListOptions(orgSlug, filters),
    ...OPERATIONAL_INFINITE_REFETCH,
  });

  const parties = useQuery({
    ...partyListOptions(orgSlug),
    enabled: canReadParties && partyId !== undefined,
  });

  const partyName = usePartyName(orgSlug, partyId, parties.data?.rows);

  const activeRowId = useMatch({ from: "/$orgSlug/payments/$paymentId", shouldThrow: false })
    ?.params.paymentId;

  const rows = payments.data?.pages.flatMap((page) => page.rows) ?? [];

  const setFilters = (patch: Partial<Filters>) =>
    navigate({ replace: true, search: (previous) => ({ ...previous, ...patch }) });

  const date = useDateRangeFilter({ from, to }, field, (range) => setFilters(range));

  const clear = () => {
    focusSearch(field, { empty: true });
    void setFilters({
      q: undefined,
      partyId: undefined,
      from: undefined,
      to: undefined,
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

  if (state)
    chips.push({
      id: "state",
      name: "State",
      label: state === "posted" ? "Posted" : "Cancelled",
      remove: () => setFilters({ state: undefined }),
    });

  if (settlementKind)
    chips.push({
      id: "settlementKind",
      name: "Settlement",
      label: LABELS[settlementKind],
      remove: () => setFilters({ settlementKind: undefined }),
    });

  // A party-filtered list seeds that party as the payee; the filter itself stays apart.
  const openCreate = () =>
    void navigate({
      search: (previous) => ({ ...previous, create: true, payeeId: previous.partyId }),
    });

  usePaletteActions(
    canPost ? [{ id: "payment:new", label: "New payment", group: "action", run: openCreate }] : [],
  );

  const closeOverlay = () =>
    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, create: undefined, payeeId: undefined }),
    }).then(() => newTrigger.current?.focus());

  const empty =
    q !== undefined || chips.length > 0 ? (
      <TableEmpty
        title="No payments match"
        description="Try another search or clear the filters."
        action={
          <Button size="xs" variant="outline" onClick={clear}>
            Clear filters
          </Button>
        }
      />
    ) : (
      <TableEmpty
        title="No payments yet"
        description="Posted payments appear here, newest first."
        action={
          canPost ? (
            <Button size="xs" variant="outline" onClick={openCreate}>
              New payment
            </Button>
          ) : undefined
        }
      />
    );

  return (
    <>
      <PageHeader
        title="Payments"
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
            label="Search payments"
            placeholder="Number, party, or reference"
            value={q}
            fieldRef={field}
            onQueryChange={(next) => void setFilters({ q: next || undefined })}
            trailing={
              <FilterMenu anchor={field} active={chips.length > 0}>
                {date.submenu}
                <FilterSubmenu icon={CircleDotIcon} label="State">
                  {STATES.map((each) => (
                    <DropdownMenuCheckboxItem
                      key={each}
                      checked={state === each}
                      onCheckedChange={(checked) =>
                        void setFilters({ state: checked ? each : undefined })
                      }
                    >
                      {each === "posted" ? "Posted" : "Cancelled"}
                    </DropdownMenuCheckboxItem>
                  ))}
                </FilterSubmenu>
                <OptionFilter
                  icon={ArrowLeftRightIcon}
                  label="Settlement"
                  options={SETTLEMENT_KINDS}
                  labels={LABELS}
                  value={settlementKind}
                  onChange={(next) => void setFilters({ settlementKind: next })}
                />
              </FilterMenu>
            }
          />
          <FilterChips filters={chips} field={field} onClear={clear} />
        </ListToolbar>
        <DataTable
          columns={PAYMENT_COLUMNS}
          data={rows}
          getRowId={(payment) => payment.id}
          meta={{ orgSlug }}
          rowLink={(payment) => ({
            to: "/$orgSlug/payments/$paymentId",
            params: { orgSlug, paymentId: payment.id },
            search: (previous) => ({ ...previous, create: undefined, payeeId: undefined }),
          })}
          renderCard={(payment) => <PaymentCard payment={payment} />}
          query={payments}
          errorTitle="Could not load payments"
          empty={empty}
          activeRowId={activeRowId}
        />
        <LoadMore query={payments} shown={rows.length} />
        <Outlet />
      </PageBody>
      {date.popover}
      {canPost && create ? (
        <PaymentOverlay orgSlug={orgSlug} today={today} partyId={payeeId} onClose={closeOverlay} />
      ) : null}
    </>
  );
}
