import { formatBusinessDay } from "@accly/api/lib/business-date";
import {
  absMoney,
  creditOf,
  debitOf,
  formatBalance,
  formatMoney,
  isZeroMoney,
} from "@accly/api/core/money";
import type { AppRouterClient } from "@accly/api/routers/index";
import { createColumnHelper } from "@tanstack/react-table";

import { DATA_TABLE_FEATURES } from "@/components/data-table/data-table";
import { grossOfTdsPaise } from "@/lib/reports";

type StatementLine = Awaited<
  ReturnType<AppRouterClient["party"]["ledgerLines"]>
>["rows"][number] & { balancePaise: bigint };

function particulars(line: StatementLine): string {
  if (line.kind === "reverse") return "Cancellation";

  if (line.documentType === "receipt" && line.settlementKind === "advance") {
    return "Advance received";
  }

  return line.typeLabel;
}

function TdsDetail({ line }: { line: StatementLine }) {
  if (line.tdsPaise === null) return null;

  const net = absMoney(line.amountPaise);

  return (
    <span className="block text-muted-foreground">
      {line.typeLabel} {formatMoney(grossOfTdsPaise(net, line.tdsPaise))} − TDS{" "}
      {formatMoney(line.tdsPaise)} = {formatMoney(net)}
    </span>
  );
}

function Amount({ paise }: { paise: bigint }) {
  return isZeroMoney(paise) ? null : <span className="tabular-nums">{formatMoney(paise)}</span>;
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
    cell: ({ getValue }) => (
      <span className="whitespace-nowrap">{formatBusinessDay(getValue())}</span>
    ),
  }),
  col.display({
    id: "particulars",
    header: "Particulars",
    cell: ({ row: { original: line } }) => (
      <span className="block">
        <span className="block truncate">
          {particulars(line)}
          {line.reference ? (
            <span className="text-muted-foreground"> · {line.reference}</span>
          ) : null}
        </span>
        <TdsDetail line={line} />
      </span>
    ),
  }),
  col.display({
    id: "debit",
    header: "Debit",
    meta: { align: "right", className: "w-money" },
    cell: ({ row: { original: line } }) => <Amount paise={debitOf(line.amountPaise)} />,
  }),
  col.display({
    id: "credit",
    header: "Credit",
    meta: { align: "right", className: "w-money" },
    cell: ({ row: { original: line } }) => <Amount paise={creditOf(line.amountPaise)} />,
  }),
  col.accessor("balancePaise", {
    header: "Balance",
    meta: { align: "right", className: "w-balance" },
    cell: ({ getValue }) => <span className="tabular-nums">{formatBalance(getValue())}</span>,
  }),
];

export function LedgerCard({ line }: { line: StatementLine }) {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono font-medium">{line.number ?? "—"}</span>
        <span className="shrink-0 tabular-nums">{formatBalance(line.amountPaise)}</span>
      </div>
      <p className="flex items-baseline justify-between gap-3 text-muted-foreground">
        <span className="min-w-0 truncate">
          {formatBusinessDay(line.entryDate)} · {particulars(line)}
        </span>
        <span className="shrink-0 tabular-nums">{formatBalance(line.balancePaise)}</span>
      </p>
      <TdsDetail line={line} />
    </>
  );
}
