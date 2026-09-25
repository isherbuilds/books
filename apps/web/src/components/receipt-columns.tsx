// Copyright (c) Midday Labs AB, AGPL-3.0, from midday-ai/midday@51587319f26a0ffaa9dfccab1920373cb65689b7
// Adapted from apps/dashboard/src/components/tables/invoices/columns.tsx (struck
// cancelled documents, right-aligned amount, actions) and invoices/actions-menu.tsx.
import { formatBusinessDay } from "@accly/api/lib/business-date";
import { formatMoney } from "@accly/api/core/money";
import type { AppRouter } from "@accly/api/routers/index";
import { DropdownMenuItem } from "@accly/ui/components/dropdown-menu";
import { cn } from "@accly/ui/lib/utils";
import type { RouterClient } from "@orpc/server";
import { createColumnHelper } from "@tanstack/react-table";

import { DATA_TABLE_FEATURES, TextOrDash } from "@/components/data-table/data-table";
import { CopyMenuItem, RowActionsMenu } from "@/components/data-table/row-actions-menu";
import { CancelledBadge, struck } from "@/components/document-columns";

type ReceiptRow = Awaited<ReturnType<RouterClient<AppRouter>["receipt"]["list"]>>["rows"][number];

const col = createColumnHelper<typeof DATA_TABLE_FEATURES, ReceiptRow>();

// No header sorts: the keyset cursor fixes the order to newest first.
export const RECEIPT_COLUMNS = [
  col.accessor("number", {
    header: "Number",
    meta: { className: "w-48" },
    cell: ({ row: { original: receipt } }) => (
      <>
        <span className={cn("font-mono", struck(receipt.state))}>{receipt.number ?? "—"}</span>
        <CancelledBadge state={receipt.state} />
      </>
    ),
  }),
  col.accessor("documentDate", {
    header: "Date",
    meta: { className: "w-24" },
    cell: ({ getValue }) => <span className="tabular-nums">{formatBusinessDay(getValue())}</span>,
  }),
  col.accessor("partyName", {
    header: "Party",
    cell: ({ getValue }) => <TextOrDash value={getValue()} />,
  }),
  col.accessor("paymentMethodName", {
    header: "Method",
    meta: { className: "hidden w-32 xl:table-cell" },
    cell: ({ getValue }) => <span title={getValue()}>{getValue()}</span>,
  }),
  col.accessor("reference", {
    header: "Reference",
    meta: { className: "hidden w-40 xl:table-cell" },
    cell: ({ getValue }) => <TextOrDash value={getValue()} />,
  }),
  col.accessor("totalPaise", {
    header: "Amount",
    meta: { align: "right", className: "w-32" },
    cell: ({ row: { original: receipt } }) => (
      <span className={cn("tabular-nums", struck(receipt.state))}>
        {formatMoney(receipt.totalPaise)}
      </span>
    ),
  }),
  col.display({
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    meta: { className: "w-10 px-1 text-center" },
    cell: ({ row, table }) => {
      const orgSlug = table.options.meta?.orgSlug;

      return orgSlug ? <ReceiptRowActions orgSlug={orgSlug} receipt={row.original} /> : null;
    },
  }),
];

export function ReceiptCard({ receipt }: { receipt: ReceiptRow }) {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("font-mono font-medium", struck(receipt.state))}>
            {receipt.number ?? "—"}
          </span>
          <CancelledBadge state={receipt.state} />
        </span>
        <span className={cn("shrink-0 tabular-nums", struck(receipt.state))}>
          {formatMoney(receipt.totalPaise)}
        </span>
      </div>
      <p className="truncate text-muted-foreground">
        {receipt.partyName ?? "No party"} · {formatBusinessDay(receipt.documentDate)} ·{" "}
        {receipt.paymentMethodName}
      </p>
    </>
  );
}

// Cancel stays in the record Sheet: it needs the reason prompt.
function ReceiptRowActions({ orgSlug, receipt }: { orgSlug: string; receipt: ReceiptRow }) {
  return (
    <RowActionsMenu label={`Actions for receipt ${receipt.number ?? ""}`.trim()}>
      <DropdownMenuItem
        onClick={() =>
          window.open(`/api/${orgSlug}/receipts/${receipt.id}/pdf`, "_blank", "noopener,noreferrer")
        }
      >
        Print
      </DropdownMenuItem>
      {receipt.number ? (
        <CopyMenuItem text={receipt.number} copied="Receipt number copied">
          Copy number
        </CopyMenuItem>
      ) : null}
    </RowActionsMenu>
  );
}
