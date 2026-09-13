import { formatMoney } from "@accly/api/core/money";
import type { AppRouter } from "@accly/api/routers/index";
import type { RouterClient } from "@orpc/server";
import { createColumnHelper } from "@tanstack/react-table";

import { formatDay } from "@/lib/org-datetime";
import { DATA_TABLE_FEATURES } from "@/components/data-table/data-table";

export type StatementLine = Awaited<
  ReturnType<RouterClient<AppRouter>["party"]["statement"]>
>["lines"][number];

/** A party balance the way a ledger prints it: Dr when the party owes, Cr for an advance held. */
export function balanceLabel(paise: bigint): string {
  if (paise === 0n) return formatMoney(0n);

  return `${formatMoney(paise < 0n ? -paise : paise)} ${paise > 0n ? "Dr" : "Cr"}`;
}

// Only receipts write party exposure today; Invoices, Bills and Notes join here as
// each Document type lands.
function particulars(line: StatementLine): string {
  if (line.kind === "reverse") return "Cancellation";

  if (line.documentType === "receipt") {
    return line.settlementKind === "advance" ? "Advance received" : "Receipt";
  }

  return line.documentType;
}

function Amount({ paise }: { paise: bigint }) {
  return paise === 0n ? null : <span className="tabular-nums">{formatMoney(paise)}</span>;
}

const col = createColumnHelper<typeof DATA_TABLE_FEATURES, StatementLine>();

export const LEDGER_COLUMNS = [
  col.accessor("number", {
    header: "Document",
    meta: { className: "w-40" },
    cell: ({ getValue }) => <span className="font-mono">{getValue() ?? "—"}</span>,
  }),
  col.accessor("entryDate", {
    header: "Date",
    meta: { className: "w-28" },
    cell: ({ getValue }) => <span className="whitespace-nowrap">{formatDay(getValue())}</span>,
  }),
  col.display({
    id: "particulars",
    header: "Particulars",
    cell: ({ row: { original: line } }) => (
      <span className="block truncate">
        {particulars(line)}
        {line.reference ? <span className="text-muted-foreground"> · {line.reference}</span> : null}
      </span>
    ),
  }),
  col.display({
    id: "debit",
    header: "Debit",
    meta: { align: "right", className: "w-32" },
    cell: ({ row: { original: line } }) => (
      <Amount paise={line.amountPaise > 0n ? line.amountPaise : 0n} />
    ),
  }),
  col.display({
    id: "credit",
    header: "Credit",
    meta: { align: "right", className: "w-32" },
    cell: ({ row: { original: line } }) => (
      <Amount paise={line.amountPaise < 0n ? -line.amountPaise : 0n} />
    ),
  }),
  col.accessor("balancePaise", {
    header: "Balance",
    meta: { align: "right", className: "w-40" },
    cell: ({ getValue }) => <span className="tabular-nums">{balanceLabel(getValue())}</span>,
  }),
];

export function LedgerCard({ line }: { line: StatementLine }) {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono font-medium">{line.number ?? "—"}</span>
        <span className="shrink-0 tabular-nums">{balanceLabel(line.amountPaise)}</span>
      </div>
      <p className="mt-1 flex items-baseline justify-between gap-3 text-muted-foreground">
        <span className="min-w-0 truncate">
          {formatDay(line.entryDate)} · {particulars(line)}
        </span>
        <span className="shrink-0 tabular-nums">{balanceLabel(line.balancePaise)}</span>
      </p>
    </>
  );
}
