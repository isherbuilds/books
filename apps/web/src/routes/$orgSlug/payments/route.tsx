import { SETTLEMENT_KINDS } from "@accly/db/schema/settlement-kinds";
import { DOCUMENT_SEARCH_PATTERN, documentSearchQuery } from "@accly/api/lib/schemas";
import { Button } from "@accly/ui/components/button";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Outlet, createFileRoute, useMatch, useNavigate } from "@tanstack/react-router";
import { ArrowLeftRightIcon, CircleDotIcon } from "lucide-react";
import { useRef } from "react";
import { useIsMutating } from "@tanstack/react-query";
import { z } from "zod";

import { DataTable } from "@/components/data-table/data-table";
import { DOCUMENT_STATE_LABELS, SETTLEMENT_KIND_LABELS } from "@/components/document-columns";
import { RegisterEmpty } from "@/components/data-table/table-empty";
import { FormSheet } from "@/components/form-sheet";
import { useDateRangeFilter } from "@/components/date-range-filter";
import {
  FilterChips,
  usePartyChip,
  FilterMenu,
  focusSearch,
  type ActiveFilter,
  OptionFilter,
} from "@/components/list-filter";
import { ListToolbar, PageBody, PageHeader, SearchInput } from "@/components/page";
import { RegisterTotals } from "@/components/register-totals";
import { usePaletteActions } from "@/components/palette/use-palette-actions";
import { PAYMENT_COLUMNS, PaymentCard } from "@/components/payment-columns";
import { PaymentForm } from "@/components/payment-form";
import { WaveLoader } from "@/components/wave-loader";
import { useCan } from "@/lib/membership";
import { OPERATIONAL_INFINITE_REFETCH } from "@/lib/operational-query";
import { useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { partyDetailOptions } from "@/lib/parties";
import { paymentListOptions } from "@/lib/payments";
import { periodSearch, requirePeriod } from "@/lib/require-period";
import { requireOrgPermission } from "@/lib/route-permission";

const STATES = ["posted", "cancelled"] as const;

const paymentSearch = z.object({
  create: z.boolean().optional().catch(undefined),
  // Seeds the new payment's party; kept apart from the `partyId` list filter.
  payeeId: z.uuid().optional().catch(undefined),
  payAgainst: z.enum(["payable", "receivable"]).optional().catch(undefined),
  q: documentSearchQuery.catch(undefined),
  partyId: z.uuid().optional().catch(undefined),
  ...periodSearch,
  state: z.enum(STATES).optional().catch(undefined),
  settlementKind: z.enum(SETTLEMENT_KINDS).optional().catch(undefined),
});

type Filters = Omit<z.infer<typeof paymentSearch>, "create" | "payeeId" | "payAgainst">;

export const Route = createFileRoute("/$orgSlug/payments")({
  head: () => ({ meta: [{ title: "Payments · Accly Books" }] }),
  validateSearch: paymentSearch,
  beforeLoad: ({ context: { queryClient }, location, params: { orgSlug }, search }) =>
    requirePeriod(queryClient, orgSlug, location, search, "this-month"),
  loaderDeps: ({
    search: { create, payeeId, payAgainst: _payAgainst, all: _all, ...filters },
  }) => ({ filters, payeeId: create ? payeeId : undefined }),
  loader: async ({ context: { queryClient }, params: { orgSlug }, deps }) => {
    await requireOrgPermission(queryClient, orgSlug, { payment: ["read"] });

    await Promise.all([
      queryClient.infiniteQuery(paymentListOptions(orgSlug, deps.filters)).catch(() => {}),
      queryClient.prefetchQuery(
        orpc.payment.totals.queryOptions({ input: { orgSlug, ...deps.filters } }),
      ),
      deps.payeeId
        ? queryClient.prefetchQuery(partyDetailOptions(orgSlug, deps.payeeId)).catch(() => {})
        : undefined,
    ]);
  },
  component: PaymentsRoute,
});

function PaymentOverlay({
  orgSlug,
  today,
  payeeId,
  payAgainst,
  onClose,
}: {
  orgSlug: string;
  today: string;
  payeeId?: string;
  payAgainst?: "payable" | "receivable";
  onClose: () => void;
}) {
  const saving = useIsMutating({ mutationKey: orpc.payment.post.mutationKey() }) > 0;

  const payee = useQuery({
    ...partyDetailOptions(orgSlug, payeeId ?? ""),
    enabled: payeeId !== undefined,
  });

  return (
    <FormSheet
      open
      onClose={onClose}
      saving={saving}
      title="New payment"
      description="Record money paid by the organization."
    >
      {payeeId && payee.isPending ? (
        <WaveLoader label="Loading party" className="justify-center px-3 py-4" />
      ) : (
        <PaymentForm
          orgSlug={orgSlug}
          today={today}
          initialParty={payee.data ? { id: payee.data.id, name: payee.data.name } : undefined}
          initialExposureSide={payAgainst}
          onClose={onClose}
        />
      )}
    </FormSheet>
  );
}

function PaymentsRoute() {
  const { orgSlug } = Route.useParams();
  const { create, payeeId, payAgainst, all: _all, ...filters } = Route.useSearch();
  const { q, partyId, from, to, state, settlementKind } = filters;
  const { today } = useOrgDateTime();
  const navigate = useNavigate({ from: Route.fullPath });
  const field = useRef<HTMLDivElement>(null);
  const newTrigger = useRef<HTMLButtonElement>(null);
  const canPost = useCan(orgSlug, { payment: ["post"] });

  const payments = useInfiniteQuery({
    ...paymentListOptions(orgSlug, filters),
    ...OPERATIONAL_INFINITE_REFETCH,
  });

  const totals = useQuery(orpc.payment.totals.queryOptions({ input: { orgSlug, ...filters } }));

  const activeRowId = useMatch({ from: "/$orgSlug/payments/$paymentId", shouldThrow: false })
    ?.params.paymentId;

  const rows = payments.data?.pages.flatMap((page) => page.rows) ?? [];

  const setFilters = (patch: Partial<Filters>) =>
    navigate({ replace: true, search: (previous) => ({ ...previous, ...patch }) });

  const partyChip = usePartyChip(orgSlug, partyId, () => setFilters({ partyId: undefined }));

  const date = useDateRangeFilter({ from, to }, field, setFilters);

  const clear = () => {
    focusSearch(field, { empty: true });
    void navigate({ replace: true, search: { all: true } });
  };

  const chips: ActiveFilter[] = [];

  if (partyChip) chips.push(partyChip);

  if (date.chip) chips.push(date.chip);

  if (state)
    chips.push({
      id: "state",
      name: "State",
      label: DOCUMENT_STATE_LABELS[state],
      remove: () => setFilters({ state: undefined }),
    });

  if (settlementKind)
    chips.push({
      id: "settlementKind",
      name: "Settlement",
      label: SETTLEMENT_KIND_LABELS[settlementKind],
      remove: () => setFilters({ settlementKind: undefined }),
    });

  // A party-filtered list seeds that party as the payee; the filter itself stays apart.
  const openCreate = () =>
    void navigate({
      search: (previous) => ({
        ...previous,
        create: true,
        payeeId: previous.partyId,
        payAgainst: undefined,
      }),
    });

  usePaletteActions(
    canPost ? [{ id: "payment:new", label: "New payment", group: "action", run: openCreate }] : [],
  );

  const closeOverlay = () =>
    void navigate({
      replace: true,
      search: (previous) => ({
        ...previous,
        create: undefined,
        payeeId: undefined,
        payAgainst: undefined,
      }),
    }).then(() => newTrigger.current?.focus());

  const empty = (
    <RegisterEmpty
      noun="payments"
      filtered={q !== undefined || chips.length > 0}
      onClear={clear}
      description="Posted payments appear here, newest first."
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
            pattern={DOCUMENT_SEARCH_PATTERN}
            label="Search payments"
            placeholder="Number, party, or reference"
            value={q}
            fieldRef={field}
            onQueryChange={(next) => void setFilters({ q: next || undefined })}
            trailing={
              <FilterMenu anchor={field} active={chips.length > 0}>
                {date.submenu}
                <OptionFilter
                  icon={CircleDotIcon}
                  label="State"
                  options={STATES}
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
        <RegisterTotals query={totals} noun={filters.state ? "payment" : "posted payment"} />
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
        <Outlet />
      </PageBody>
      {date.popover}
      {canPost && create ? (
        <PaymentOverlay
          key={`${payeeId ?? ""}:${payAgainst ?? ""}`}
          orgSlug={orgSlug}
          today={today}
          payeeId={payeeId}
          payAgainst={payAgainst}
          onClose={closeOverlay}
        />
      ) : null}
    </>
  );
}
