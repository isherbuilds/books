import { formatBusinessDay } from "@accly/api/lib/business-date";
import { formatMoney } from "@accly/api/core/money";
import type { AppRouter } from "@accly/api/routers/index";
import { cn } from "@accly/ui/lib/utils";
import type { RouterClient } from "@orpc/server";
import { createColumnHelper } from "@tanstack/react-table";

import { DATA_TABLE_FEATURES, TextOrDash } from "@/components/data-table/data-table";
import { CancelledBadge, SETTLEMENT_KIND_LABELS, struck } from "@/components/document-columns";

type PaymentRow = Awaited<ReturnType<RouterClient<AppRouter>["payment"]["list"]>>["rows"][number];

const col = createColumnHelper<typeof DATA_TABLE_FEATURES, PaymentRow>();

function paymentKind(payment: PaymentRow): string {
  if (payment.exposureSide === "receivable") return "Refund";

  return SETTLEMENT_KIND_LABELS[payment.settlementKind ?? "direct"];
}

export const PAYMENT_COLUMNS = [
  col.accessor("number", {
    header: "Number",
    meta: { className: "w-48" },
    cell: ({ row: { original: payment } }) => (
      <span className="flex items-center gap-2">
        <span className={cn("font-mono", struck(payment.state))}>{payment.number ?? "—"}</span>
        <CancelledBadge state={payment.state} />
      </span>
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
  col.accessor("settlementKind", {
    header: "Kind",
    cell: ({ row: { original: payment } }) => <span>{paymentKind(payment)}</span>,
  }),
  col.accessor("totalPaise", {
    header: "Amount",
    meta: { align: "right", className: "w-32" },
    cell: ({ row: { original: payment } }) => (
      <span className={cn("tabular-nums", struck(payment.state))}>
        {formatMoney(payment.totalPaise)}
      </span>
    ),
  }),
];

export function PaymentCard({ payment }: { payment: PaymentRow }) {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("font-mono font-medium", struck(payment.state))}>
            {payment.number ?? "—"}
          </span>
          <CancelledBadge state={payment.state} />
        </span>
        <span className={cn("shrink-0 tabular-nums", struck(payment.state))}>
          {formatMoney(payment.totalPaise)}
        </span>
      </div>
      <p className="truncate text-muted-foreground">
        {payment.partyName ?? "No party"} · {formatBusinessDay(payment.documentDate)} ·{" "}
        {paymentKind(payment)}
      </p>
    </>
  );
}
