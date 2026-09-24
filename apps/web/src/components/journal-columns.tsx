import { formatBusinessDay } from "@accly/api/lib/business-date";
import { formatMoney } from "@accly/api/core/money";
import type { AppRouter } from "@accly/api/routers/index";
import { cn } from "@accly/ui/lib/utils";
import type { RouterClient } from "@orpc/server";
import { createColumnHelper } from "@tanstack/react-table";

import { DATA_TABLE_FEATURES, TextOrDash } from "@/components/data-table/data-table";
import { CopyMenuItem, RowActionsMenu } from "@/components/data-table/row-actions-menu";
import { CancelledBadge, struck } from "@/components/document-columns";

type JournalRow = Awaited<ReturnType<RouterClient<AppRouter>["journal"]["list"]>>["rows"][number];

const col = createColumnHelper<typeof DATA_TABLE_FEATURES, JournalRow>();

export const JOURNAL_COLUMNS = [
  col.accessor("number", {
    header: "Number",
    meta: { className: "w-48" },
    cell: ({ row: { original: journal } }) => (
      <>
        <span className={cn("font-mono", struck(journal.state))}>{journal.number}</span>
        <CancelledBadge state={journal.state} />
      </>
    ),
  }),
  col.accessor("documentDate", {
    header: "Date",
    meta: { className: "w-24" },
    cell: ({ getValue }) => <span className="tabular-nums">{formatBusinessDay(getValue())}</span>,
  }),
  col.accessor("narration", {
    header: "Narration",
    cell: ({ getValue }) => {
      const narration = getValue();

      return (
        <span className="block truncate" title={narration ?? undefined}>
          {narration ?? "—"}
        </span>
      );
    },
  }),
  col.accessor("reference", {
    header: "Reference",
    meta: { className: "hidden w-40 xl:table-cell" },
    cell: ({ getValue }) => <TextOrDash value={getValue()} />,
  }),
  col.accessor("totalPaise", {
    header: "Amount",
    meta: { align: "right", className: "w-32" },
    cell: ({ row: { original: journal } }) => (
      <span className={cn("tabular-nums", struck(journal.state))}>
        {formatMoney(journal.totalPaise)}
      </span>
    ),
  }),
  col.display({
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    meta: { className: "w-10 px-1 text-center" },
    cell: ({ row }) => <JournalRowActions journal={row.original} />,
  }),
];

export function JournalCard({ journal }: { journal: JournalRow }) {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("font-mono font-medium", struck(journal.state))}>
            {journal.number}
          </span>
          <CancelledBadge state={journal.state} />
        </span>
        <span className={cn("shrink-0 tabular-nums", struck(journal.state))}>
          {formatMoney(journal.totalPaise)}
        </span>
      </div>
      <p className="mt-1 truncate text-muted-foreground">
        {journal.narration ?? "No narration"} · {formatBusinessDay(journal.documentDate)}
        {journal.reference ? ` · ${journal.reference}` : null}
      </p>
    </>
  );
}

function JournalRowActions({ journal }: { journal: JournalRow }) {
  return (
    <RowActionsMenu label={`Actions for journal ${journal.number}`}>
      <CopyMenuItem text={journal.number} copied="Journal number copied">
        Copy number
      </CopyMenuItem>
    </RowActionsMenu>
  );
}
