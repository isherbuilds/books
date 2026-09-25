import { formatMoney } from "@accly/api/core/money";
import { formatBusinessDay } from "@accly/api/lib/business-date";
import { cn } from "@accly/ui/lib/utils";
import { createColumnHelper } from "@tanstack/react-table";

import { DATA_TABLE_FEATURES, TextOrDash } from "@/components/data-table/data-table";
import { ClaimStatus, struck } from "@/components/document-columns";
import type { BillListRow } from "@/lib/bills";

const column = createColumnHelper<typeof DATA_TABLE_FEATURES, BillListRow>();

export const BILL_COLUMNS = [
  column.accessor("number", {
    header: "Number",
    meta: { className: "w-36" },
    cell: ({ row: { original: bill } }) => (
      <span className={cn("font-mono", struck(bill.state))}>{bill.number ?? "Draft"}</span>
    ),
  }),
  column.accessor("reference", {
    header: "Supplier invoice",
    meta: { className: "w-36" },
    cell: ({ getValue }) => <TextOrDash value={getValue()} />,
  }),
  column.accessor("partyName", {
    header: "Supplier",
    cell: ({ getValue }) => <TextOrDash value={getValue()} />,
  }),
  column.accessor("documentDate", {
    header: "Date",
    meta: { className: "hidden w-24 lg:table-cell" },
    cell: ({ getValue }) => <span className="tabular-nums">{formatBusinessDay(getValue())}</span>,
  }),
  column.accessor("dueDate", {
    header: "Due date",
    meta: { className: "hidden w-24 lg:table-cell" },
    cell: ({ getValue }) => (
      <span className="tabular-nums">{getValue() ? formatBusinessDay(getValue()!) : "—"}</span>
    ),
  }),
  column.accessor("totalPaise", {
    header: "Total",
    meta: { align: "right", className: "w-32" },
    cell: ({ row: { original: bill } }) => (
      <span className={cn("tabular-nums", struck(bill.state))}>{formatMoney(bill.totalPaise)}</span>
    ),
  }),
  column.display({
    id: "status",
    header: "Status",
    meta: { className: "w-44" },
    cell: ({ row: { original: bill } }) => <ClaimStatus claim={bill} />,
  }),
];

export function BillCard({ bill }: { bill: BillListRow }) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className={cn("font-mono font-medium", struck(bill.state))}>
            {bill.number ?? "Draft"}
          </span>
          <ClaimStatus claim={bill} />
        </span>
        <span className={cn("shrink-0 tabular-nums", struck(bill.state))}>
          {formatMoney(bill.totalPaise)}
        </span>
      </div>
      <p className="truncate text-muted-foreground">
        {bill.partyName ?? "No supplier"} · {formatBusinessDay(bill.documentDate)}
        {bill.dueDate ? ` · Due ${formatBusinessDay(bill.dueDate)}` : ""}
      </p>
      {bill.reference ? (
        <p className="truncate font-mono text-muted-foreground">{bill.reference}</p>
      ) : null}
    </>
  );
}
