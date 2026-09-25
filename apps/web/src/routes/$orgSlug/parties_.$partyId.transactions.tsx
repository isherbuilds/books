import { formatBusinessDay } from "@accly/api/lib/business-date";
import { formatMoney } from "@accly/api/core/money";
import type { AppRouterClient } from "@accly/api/routers/index";
import { Badge } from "@accly/ui/components/badge";
import { cn } from "@accly/ui/lib/utils";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, type LinkOptions } from "@tanstack/react-router";
import { createColumnHelper } from "@tanstack/react-table";

import { DATA_TABLE_FEATURES, DataTable, TextOrDash } from "@/components/data-table/data-table";
import { TableEmpty } from "@/components/data-table/table-empty";
import { CancelledBadge, struck } from "@/components/document-columns";
import { LoadMore } from "@/components/page";
import { OPERATIONAL_INFINITE_REFETCH } from "@/lib/operational-query";
import { orpc } from "@/lib/orpc";

type TransactionRow = Awaited<ReturnType<AppRouterClient["party"]["transactions"]>>["rows"][number];

const TYPE_LABELS: Record<TransactionRow["type"], string> = {
  invoice: "Invoice",
  bill: "Bill",
  creditNote: "Credit note",
  debitNote: "Debit note",
  receipt: "Receipt",
  payment: "Payment",
};

const transactionListOptions = (orgSlug: string, partyId: string) =>
  orpc.party.transactions.infiniteOptions({
    input: (cursor: string | undefined) => ({ orgSlug, partyId, cursor }),
    initialPageParam: undefined,
    getNextPageParam: (last) => (last.hasMore ? last.rows.at(-1)?.id : undefined),
  });

export const Route = createFileRoute("/$orgSlug/parties_/$partyId/transactions")({
  loader: async ({ context: { queryClient }, params: { orgSlug, partyId } }) => {
    await queryClient.infiniteQuery(transactionListOptions(orgSlug, partyId)).catch(() => {});
  },
  component: PartyTransactions,
});

// A draft has no number yet; only the exceptions carry a badge.
function TransactionNumber({ row }: { row: TransactionRow }) {
  return (
    <>
      <span className={cn("font-mono", struck(row.state))}>{row.number ?? "—"}</span>
      {row.state === "draft" ? <Badge variant="outline">Draft</Badge> : null}
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
    meta: { className: "w-28" },
    cell: ({ getValue }) => TYPE_LABELS[getValue()],
  }),
  col.accessor("reference", {
    header: "Reference",
    meta: { className: "hidden md:table-cell" },
    cell: ({ getValue }) => <TextOrDash value={getValue()} />,
  }),
  col.accessor("totalPaise", {
    header: "Amount",
    meta: { align: "right", className: "w-32" },
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
        <span>{TYPE_LABELS[row.type]}</span>
        <span className="tabular-nums">{formatBusinessDay(row.documentDate)}</span>
      </div>
    </>
  );
}

// Each record opens over its own register filtered to this party, so Back and the
// list behind the Sheet stay on this party's documents.
function transactionLink(orgSlug: string, partyId: string, row: TransactionRow): LinkOptions {
  switch (row.type) {
    case "invoice":
      return {
        to: "/$orgSlug/invoices/$invoiceId",
        params: { orgSlug, invoiceId: row.id },
        search: { partyId },
      };
    case "bill":
      return {
        to: "/$orgSlug/bills/$billId",
        params: { orgSlug, billId: row.id },
        search: { partyId },
      };
    case "creditNote":
    case "debitNote":
      return {
        to: "/$orgSlug/notes/$noteId",
        params: { orgSlug, noteId: row.id },
        search: { partyId },
      };
    case "receipt":
      return {
        to: "/$orgSlug/receipts/$receiptId",
        params: { orgSlug, receiptId: row.id },
        search: { partyId },
      };
    case "payment":
      return {
        to: "/$orgSlug/payments/$paymentId",
        params: { orgSlug, paymentId: row.id },
        search: { partyId },
      };
  }
}

function PartyTransactions() {
  const { orgSlug, partyId } = Route.useParams();

  const transactions = useInfiniteQuery({
    ...transactionListOptions(orgSlug, partyId),
    ...OPERATIONAL_INFINITE_REFETCH,
  });

  const rows = transactions.data?.pages.flatMap((page) => page.rows) ?? [];

  return (
    <>
      <DataTable
        columns={TRANSACTION_COLUMNS}
        data={rows}
        getRowId={(row) => row.id}
        meta={{ orgSlug }}
        rowLink={(row) => transactionLink(orgSlug, partyId, row)}
        renderCard={(row) => <TransactionCard row={row} />}
        query={transactions}
        errorTitle="Could not load transactions"
        empty={
          <TableEmpty
            title="No transactions yet"
            description="Invoices, bills, notes, receipts and payments for this party appear here, newest first."
          />
        }
      />
      <LoadMore query={transactions} shown={rows.length} />
    </>
  );
}
