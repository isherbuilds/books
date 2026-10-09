import { formatBusinessDay } from "@accly/api/lib/business-date";
import { formatBalance, formatMoney } from "@accly/api/core/money";
import { documentLabel } from "@accly/api/lib/document-labels";
import { authorize } from "@accly/auth/access";
import type { AppRouterClient } from "@accly/api/routers/index";
import { Badge } from "@accly/ui/components/badge";
import { cn } from "@accly/ui/lib/utils";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createColumnHelper } from "@tanstack/react-table";
import { z } from "zod";

import { DATA_TABLE_FEATURES, DataTable, TextOrDash } from "@/components/data-table/data-table";
import { TableEmpty } from "@/components/data-table/table-empty";
import { CancelledBadge, struck } from "@/components/document-columns";
import { PeriodMenu } from "@/components/date-range-filter";
import { ListToolbar } from "@/components/page";
import type { SearchRange } from "@/lib/date-presets";
import { membershipOptions, useCan } from "@/lib/membership";
import { OPERATIONAL_INFINITE_REFETCH } from "@/lib/operational-query";
import { keysetPaging, orpc } from "@/lib/orpc";
import { partyDocumentLink, partyLedgerSummaryOptions } from "@/lib/parties";
import { periodSearch, requirePeriod } from "@/lib/require-period";

type TransactionRow = Awaited<ReturnType<AppRouterClient["party"]["transactions"]>>["rows"][number];

const transactionListOptions = (orgSlug: string, partyId: string, range: DateBounds) =>
  orpc.party.transactions.infiniteOptions({
    input: (cursor: string | undefined) => ({ orgSlug, partyId, ...range, cursor }),
    ...keysetPaging,
  });

const transactionSearch = z.object({
  ...periodSearch,
});

type DateBounds = Omit<z.infer<typeof transactionSearch>, "all">;

export const Route = createFileRoute("/$orgSlug/parties_/$partyId/transactions")({
  validateSearch: transactionSearch,
  beforeLoad: ({ context: { queryClient }, location, params: { orgSlug }, search }) =>
    requirePeriod(queryClient, orgSlug, location, search, "this-year"),
  loaderDeps: ({ search: { all: _all, ...range } }) => range,
  loader: async ({ context: { queryClient }, deps, params: { orgSlug, partyId } }) => {
    const { roles } = await queryClient.query(membershipOptions(orgSlug));
    await Promise.all([
      queryClient.infiniteQuery(transactionListOptions(orgSlug, partyId, deps)).catch(() => {}),
      authorize(roles, { report: ["read"] }) &&
        queryClient.query(partyLedgerSummaryOptions(orgSlug, partyId)).catch(() => {}),
    ]);
  },
  component: PartyTransactions,
});

// A draft has no number yet; only the exceptions carry a badge.
function TransactionNumber({ row }: { row: TransactionRow }) {
  return (
    <>
      <span className={cn("font-mono", struck(row.state))}>{row.number ?? "—"}</span>
      {row.state === "draft" ? <Badge variant="warn">Draft</Badge> : null}
      <CancelledBadge state={row.state} />
    </>
  );
}

const col = createColumnHelper<typeof DATA_TABLE_FEATURES, TransactionRow>();

// No header sorts: the keyset cursor fixes the order to newest first.
const TRANSACTION_COLUMNS = [
  col.accessor("number", {
    header: "Number",
    meta: { className: "w-48" },
    cell: ({ row }) => <TransactionNumber row={row.original} />,
  }),
  col.accessor("documentDate", {
    header: "Date",
    meta: { className: "w-24" },
    cell: ({ getValue }) => <span className="tabular-nums">{formatBusinessDay(getValue())}</span>,
  }),
  col.accessor("type", {
    header: "Type",
    meta: { className: "w-36" },
    cell: ({ row }) => documentLabel(row.original.type, row.original.exposureSide),
  }),
  col.accessor("reference", {
    header: "Reference",
    meta: { className: "hidden md:table-cell" },
    cell: ({ getValue }) => <TextOrDash value={getValue()} />,
  }),
  col.accessor("totalPaise", {
    header: "Amount",
    meta: { align: "right", className: "w-money" },
    cell: ({ row: { original } }) => (
      <span className={cn("tabular-nums", struck(original.state))}>
        {formatMoney(original.totalPaise)}
      </span>
    ),
  }),
];

function TransactionCard({ row }: { row: TransactionRow }) {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 font-medium">
          <TransactionNumber row={row} />
        </span>
        <span className={cn("tabular-nums", struck(row.state))}>{formatMoney(row.totalPaise)}</span>
      </div>
      <div className="flex items-center justify-between gap-3 text-muted-foreground">
        <span>{documentLabel(row.type, row.exposureSide)}</span>
        <span className="tabular-nums">{formatBusinessDay(row.documentDate)}</span>
      </div>
    </>
  );
}

function PartyTransactions() {
  const { orgSlug, partyId } = Route.useParams();
  const { all: _all, ...range } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const canReadLedger = useCan(orgSlug, { report: ["read"] });

  const transactions = useInfiniteQuery({
    ...transactionListOptions(orgSlug, partyId, range),
    ...OPERATIONAL_INFINITE_REFETCH,
  });

  const summary = useQuery({
    ...partyLedgerSummaryOptions(orgSlug, partyId),
    enabled: canReadLedger,
  });

  const rows = transactions.data?.pages.flatMap((page) => page.rows) ?? [];

  const setSearch = (next: SearchRange) =>
    void navigate({ replace: true, search: (previous) => ({ ...previous, ...next }) });

  return (
    <>
      <ListToolbar>
        <PeriodMenu range={range} onChange={setSearch} />
        {canReadLedger && summary.data ? (
          <p className="ml-auto text-muted-foreground">
            Balance{" "}
            <span className="font-medium text-foreground tabular-nums">
              {formatBalance(summary.data.closingPaise)}
            </span>
          </p>
        ) : null}
      </ListToolbar>
      <DataTable
        columns={TRANSACTION_COLUMNS}
        data={rows}
        getRowId={(row) => row.id}
        meta={{ orgSlug }}
        rowLink={(row) => partyDocumentLink(orgSlug, partyId, row.type, row.id)}
        renderCard={(row) => <TransactionCard row={row} />}
        query={transactions}
        errorTitle="Could not load transactions"
        empty={
          range.from || range.to ? (
            <TableEmpty
              title="No transactions in this period"
              description="Choose a longer period or All time to see older documents."
            />
          ) : (
            <TableEmpty
              title="No transactions yet"
              description="Invoices, bills, notes, receipts and payments for this party appear here, newest first."
            />
          )
        }
      />
    </>
  );
}
