import { formatMoney, isPositiveMoney } from "@accly/api/core/money";
import { formatBusinessDay } from "@accly/api/lib/business-date";
import { Badge } from "@accly/ui/components/badge";
import { cn } from "@accly/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { createColumnHelper } from "@tanstack/react-table";

import { DATA_TABLE_FEATURES, TextOrDash } from "@/components/data-table/data-table";
import { struck } from "@/components/document-columns";
import { NOTE_TYPE_LABELS, type NoteListRow } from "@/lib/notes";

/** A note's source: the invoice a credit note reduces, or the bill a debit note does. */
export function NoteSourceLink({
  orgSlug,
  noteType,
  source,
  className,
}: {
  orgSlug: string;
  noteType: keyof typeof NOTE_TYPE_LABELS;
  source: { id: string; number: string | null };
  className?: string;
}) {
  const props = {
    className: cn("font-mono underline-offset-4 hover:underline", className),
    // Inside a list row, the link opens the source rather than the note.
    onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  };

  return noteType === "creditNote" ? (
    <Link to="/$orgSlug/invoices/$invoiceId" params={{ orgSlug, invoiceId: source.id }} {...props}>
      {source.number}
    </Link>
  ) : (
    <Link to="/$orgSlug/bills/$billId" params={{ orgSlug, billId: source.id }} {...props}>
      {source.number}
    </Link>
  );
}

const column = createColumnHelper<typeof DATA_TABLE_FEATURES, NoteListRow>();

export const NOTE_COLUMNS = [
  column.accessor("number", {
    header: "Number",
    meta: { className: "w-36" },
    cell: ({ row: { original: note } }) => (
      <span className={cn("font-mono", struck(note.state))}>{note.number}</span>
    ),
  }),
  column.accessor("type", {
    header: "Type",
    meta: { className: "w-28" },
    cell: ({ getValue }) => NOTE_TYPE_LABELS[getValue()],
  }),
  column.accessor("againstNumber", {
    header: "Against",
    meta: { className: "w-36" },
    cell: ({ row: { original: note }, table }) =>
      note.againstDocumentId ? (
        <NoteSourceLink
          orgSlug={table.options.meta!.orgSlug}
          noteType={note.type}
          source={{ id: note.againstDocumentId, number: note.againstNumber }}
        />
      ) : (
        "—"
      ),
  }),
  column.accessor("partyName", {
    header: "Party",
    cell: ({ getValue }) => <TextOrDash value={getValue()} />,
  }),
  column.accessor("documentDate", {
    header: "Date",
    meta: { className: "w-24" },
    cell: ({ getValue }) => <span className="tabular-nums">{formatBusinessDay(getValue())}</span>,
  }),
  column.accessor("totalPaise", {
    header: "Total",
    meta: { align: "right", className: "w-32" },
    cell: ({ row: { original: note } }) => (
      <span className={cn("tabular-nums", struck(note.state))}>{formatMoney(note.totalPaise)}</span>
    ),
  }),
  column.accessor("unappliedPaise", {
    header: "Unapplied",
    meta: { align: "right", className: "w-32" },
    cell: ({ getValue }) => <span className="tabular-nums">{formatMoney(getValue())}</span>,
  }),
  column.accessor("state", {
    header: "Status",
    meta: { className: "w-24" },
    cell: ({ row: { original: note } }) => (
      <Badge variant={note.state === "cancelled" ? "muted" : "outline"}>
        {note.state === "cancelled"
          ? "Cancelled"
          : isPositiveMoney(note.unappliedPaise)
            ? "Unapplied"
            : "Applied"}
      </Badge>
    ),
  }),
];

export function NoteCard({ note }: { note: NoteListRow }) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className={cn("font-mono font-medium", struck(note.state))}>{note.number}</span>
        <span className={cn("tabular-nums", struck(note.state))}>
          {formatMoney(note.totalPaise)}
        </span>
      </div>
      <p className="truncate text-muted-foreground">
        {NOTE_TYPE_LABELS[note.type]} · {note.partyName ?? "No party"} ·{" "}
        {formatBusinessDay(note.documentDate)}
      </p>
      <p className="flex items-center justify-between gap-2 text-muted-foreground">
        {/* The whole card is a link, so the source is plain text here, never a nested anchor. */}
        <span className="font-mono">{note.againstNumber ?? "—"}</span>
        <span className="tabular-nums">Unapplied {formatMoney(note.unappliedPaise)}</span>
      </p>
    </>
  );
}
