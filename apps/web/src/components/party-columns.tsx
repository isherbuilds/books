// Copyright (c) Midday Labs AB, AGPL-3.0, from midday-ai/midday@51587319f26a0ffaa9dfccab1920373cb65689b7
// Adapted from apps/dashboard/src/components/tables/customers/columns.tsx (name cell,
// money columns, tags, actions) and customers-column-visibility.tsx (optional columns).
import { formatMoney } from "@accly/api/core/money";
import { INDIAN_STATES } from "@accly/api/lib/indian-states";
import type { AppRouter } from "@accly/api/routers/index";
import { Badge } from "@accly/ui/components/badge";
import { DropdownMenuItem } from "@accly/ui/components/dropdown-menu";
import { cn } from "@accly/ui/lib/utils";
import type { RouterClient } from "@orpc/server";
import { Link } from "@tanstack/react-router";
import { createColumnHelper } from "@tanstack/react-table";

import { DATA_TABLE_FEATURES, Dash, TextOrDash } from "@/components/data-table/data-table";
import { CopyMenuItem, RowActionsMenu } from "@/components/data-table/row-actions-menu";
import { Monogram } from "@/components/monogram";
import { useCan } from "@/lib/membership";
import { formatDay } from "@/lib/org-datetime";
import { ROLE_LABELS } from "@/lib/parties";

type PartyListRow = Awaited<ReturnType<RouterClient<AppRouter>["party"]["list"]>>[number];

type PartyTotals = Awaited<ReturnType<RouterClient<AppRouter>["receipt"]["partyTotals"]>>[number];

/** `totals` is undefined while loading or without the receipt grant, null with no posted receipt. */
export type PartyRow = PartyListRow & { totals: PartyTotals | null | undefined };

/** Sortable columns other than Name, which is the resting order. */
export const PARTY_SORTS = ["state", "gstin", "city", "received", "lastReceipt"] as const;

export const PARTY_OPTIONAL_COLUMNS = ["receipts", "email", "pan", "city", "pinCode"] as const;

export type PartyOptionalColumn = (typeof PARTY_OPTIONAL_COLUMNS)[number];

export const PARTY_OPTIONAL_COLUMN_LABELS: Record<PartyOptionalColumn, string> = {
  receipts: "Receipts",
  email: "Email",
  pan: "PAN",
  city: "City",
  pinCode: "PIN",
};

const col = createColumnHelper<typeof DATA_TABLE_FEATURES, PartyRow>();

// Optional columns carry no width: in a fixed layout they share the space left by
// the fixed columns with Name, so turning one on never pushes the table wider.
export const PARTY_COLUMNS = [
  col.accessor("name", {
    header: "Name",
    sortFn: "collated",
    enableHiding: false,
    cell: ({ row: { original: party } }) => (
      <>
        <Monogram label={party.name} tone="accent" />
        <span
          title={party.name}
          className={cn("truncate", !party.active && "text-muted-foreground")}
        >
          {party.name}
        </span>
        {party.active ? null : <Badge variant="muted">Inactive</Badge>}
      </>
    ),
  }),
  col.accessor("roles", {
    header: "Roles",
    enableSorting: false,
    meta: { className: "hidden w-44 2xl:table-cell" },
    cell: ({ getValue }) => (
      <span className="flex gap-1 overflow-hidden">
        {getValue().map((role) => (
          <Badge key={role} variant="muted">
            {ROLE_LABELS[role]}
          </Badge>
        ))}
      </span>
    ),
  }),
  col.accessor((party) => INDIAN_STATES[party.stateCode] ?? party.stateCode, {
    id: "state",
    header: "State",
    sortFn: "collated",
    meta: { className: "w-36" },
    cell: ({ row: { original: party }, getValue }) => (
      <span className="flex min-w-0 gap-1.5" title={getValue()}>
        <span className="font-mono text-muted-foreground tabular-nums">{party.stateCode}</span>
        <span className="truncate">{getValue()}</span>
      </span>
    ),
  }),
  // Undefined sorts last both ways; the first defined value is text, so the first
  // click sorts ascending.
  col.accessor((party) => party.gstin ?? undefined, {
    id: "gstin",
    header: "GSTIN",
    sortFn: "collated",
    sortUndefined: "last",
    meta: { className: "w-40" },
    cell: ({ row: { original: party } }) => <TextOrDash value={party.gstin} mono />,
  }),
  col.accessor("phone", {
    header: "Phone",
    enableSorting: false,
    meta: { className: "hidden w-32 xl:table-cell" },
    cell: ({ getValue }) => <TextOrDash value={getValue()} mono />,
  }),
  // No receipt sorts as zero, so the column needs no undefined handling.
  col.accessor((party) => party.totals?.receivedPaise ?? 0n, {
    id: "received",
    header: "Received",
    sortFn: "basic",
    sortDescFirst: true,
    meta: { align: "right", className: "w-32" },
    cell: ({ row: { original: party } }) => <Received totals={party.totals} />,
  }),
  col.accessor((party) => party.totals?.lastReceiptDate ?? undefined, {
    id: "lastReceipt",
    header: "Last receipt",
    sortFn: "basic",
    sortUndefined: "last",
    sortDescFirst: true,
    meta: { className: "hidden w-28 xl:table-cell" },
    cell: ({ row: { original: party } }) =>
      party.totals === undefined ? null : party.totals === null ? (
        <Dash />
      ) : (
        <span className="tabular-nums">{formatDay(party.totals.lastReceiptDate)}</span>
      ),
  }),
  col.accessor((party) => party.totals?.receiptCount, {
    id: "receipts",
    header: "Receipts",
    enableSorting: false,
    meta: { align: "right" },
    cell: ({ row: { original: party } }) =>
      party.totals === undefined ? null : (
        <span className="tabular-nums">{party.totals?.receiptCount ?? 0}</span>
      ),
  }),
  col.accessor("email", {
    header: "Email",
    enableSorting: false,
    cell: ({ getValue }) => <TextOrDash value={getValue()} />,
  }),
  col.accessor("pan", {
    header: "PAN",
    enableSorting: false,
    cell: ({ getValue }) => <TextOrDash value={getValue()} mono />,
  }),
  col.accessor((party) => party.city ?? undefined, {
    id: "city",
    header: "City",
    sortFn: "collated",
    sortUndefined: "last",
    cell: ({ row: { original: party } }) => <TextOrDash value={party.city} />,
  }),
  col.accessor("pinCode", {
    header: "PIN",
    enableSorting: false,
    cell: ({ getValue }) => <TextOrDash value={getValue()} mono />,
  }),
  col.display({
    id: "actions",
    enableHiding: false,
    enableSorting: false,
    header: () => <span className="sr-only">Actions</span>,
    meta: { className: "w-10 px-1 text-center" },
    cell: ({ row, table }) => {
      const orgSlug = table.options.meta?.orgSlug;

      return orgSlug ? <PartyRowActions orgSlug={orgSlug} party={row.original} /> : null;
    },
  }),
];

// Nothing stands in while totals load; "—" means no posted receipt.
function Received({ totals }: { totals: PartyTotals | null | undefined }) {
  if (totals === undefined) return null;

  if (totals === null) return <Dash />;

  return <span className="tabular-nums">{formatMoney(totals.receivedPaise)}</span>;
}

export function PartyCard({ party }: { party: PartyRow }) {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("truncate font-medium", !party.active && "text-muted-foreground")}>
            {party.name}
          </span>
          {party.active ? null : <Badge variant="muted">Inactive</Badge>}
        </span>
        {party.totals ? (
          <span className="shrink-0 tabular-nums">{formatMoney(party.totals.receivedPaise)}</span>
        ) : null}
      </div>
      <p className="mt-1 truncate text-muted-foreground">
        {party.roles.map((role) => ROLE_LABELS[role]).join(", ")} ·{" "}
        {INDIAN_STATES[party.stateCode] ?? party.stateCode}
        {party.gstin ? ` · ${party.gstin}` : ""}
      </p>
    </>
  );
}

function PartyRowActions({ orgSlug, party }: { orgSlug: string; party: PartyRow }) {
  return (
    <RowActionsMenu label={`Actions for ${party.name}`}>
      <PartyActionItems orgSlug={orgSlug} party={party} />
    </RowActionsMenu>
  );
}

// Mounted only while the menu is open, so a long list holds no permission reads.
function PartyActionItems({ orgSlug, party }: { orgSlug: string; party: PartyRow }) {
  const canUpdate = useCan(orgSlug, { party: ["update"] });
  const canReadReceipts = useCan(orgSlug, { receipt: ["read"] });

  return (
    <>
      <DropdownMenuItem
        render={<Link to="/$orgSlug/parties/$partyId" params={{ orgSlug, partyId: party.id }} />}
      >
        Open party
      </DropdownMenuItem>
      {canUpdate ? (
        <DropdownMenuItem
          render={
            <Link
              to="/$orgSlug/parties/$partyId"
              params={{ orgSlug, partyId: party.id }}
              search={{ edit: true }}
            />
          }
        >
          Edit party
        </DropdownMenuItem>
      ) : null}
      {canReadReceipts ? (
        <DropdownMenuItem
          render={
            <Link
              to="/$orgSlug/parties/$partyId/receipts"
              params={{ orgSlug, partyId: party.id }}
            />
          }
        >
          View receipts
        </DropdownMenuItem>
      ) : null}
      {party.gstin ? (
        <CopyMenuItem text={party.gstin} copied="GSTIN copied">
          Copy GSTIN
        </CopyMenuItem>
      ) : null}
    </>
  );
}
