import { formatMoney } from "@accly/api/core/money";
import { formatBusinessDay } from "@accly/api/lib/business-date";
import { cn } from "@accly/ui/lib/utils";
import { createColumnHelper } from "@tanstack/react-table";

import { DATA_TABLE_FEATURES, TextOrDash } from "@/components/data-table/data-table";
import { ClaimStatus, struck } from "@/components/document-columns";
import type { InvoiceListRow } from "@/lib/invoices";

const column = createColumnHelper<typeof DATA_TABLE_FEATURES, InvoiceListRow>();

export const INVOICE_COLUMNS = [
  column.accessor("number", {
    header: "Number",
    meta: { className: "w-44" },
    cell: ({ row: { original: invoice } }) => (
      <span className={cn("font-mono", struck(invoice.state))}>{invoice.number ?? "Draft"}</span>
    ),
  }),
  column.accessor("documentDate", {
    header: "Date",
    meta: { className: "w-24" },
    cell: ({ getValue }) => <span className="tabular-nums">{formatBusinessDay(getValue())}</span>,
  }),
  column.accessor("dueDate", {
    header: "Due date",
    meta: { className: "hidden w-24 lg:table-cell" },
    cell: ({ getValue }) => {
      const dueDate = getValue();

      return <span className="tabular-nums">{dueDate ? formatBusinessDay(dueDate) : "—"}</span>;
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
    cell: ({ row: { original: invoice } }) => <ClaimStatus claim={invoice} />,
  }),
  column.accessor("totalPaise", {
    header: "Total",
    meta: { align: "right", className: "w-32" },
    cell: ({ row: { original: invoice } }) => (
      <span className={cn("tabular-nums", struck(invoice.state))}>
        {formatMoney(invoice.totalPaise)}
      </span>
    ),
  }),
];

export function InvoiceCard({ invoice }: { invoice: InvoiceListRow }) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className={cn("font-mono font-medium", struck(invoice.state))}>
            {invoice.number ?? "Draft"}
          </span>
          <ClaimStatus claim={invoice} />
        </span>
        <span className={cn("shrink-0 tabular-nums", struck(invoice.state))}>
          {formatMoney(invoice.totalPaise)}
        </span>
      </div>
      <p className="truncate text-muted-foreground">
        {invoice.partyName ?? "No party"} · {formatBusinessDay(invoice.documentDate)}
        {invoice.dueDate ? ` · Due ${formatBusinessDay(invoice.dueDate)}` : ""}
      </p>
    </>
  );
}
