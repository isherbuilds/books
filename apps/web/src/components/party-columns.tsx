// Copyright (c) Midday Labs AB, AGPL-3.0, from midday-ai/midday@51587319f26a0ffaa9dfccab1920373cb65689b7
// Adapted from apps/dashboard/src/components/tables/customers/columns.tsx (name cell,
// money column, tags, actions).
import { ZERO_MONEY, formatBalance } from "@accly/api/core/money";
import { Badge } from "@accly/ui/components/badge";
import { DropdownMenuItem } from "@accly/ui/components/dropdown-menu";
import { cn } from "@accly/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { createColumnHelper } from "@tanstack/react-table";

import { DATA_TABLE_FEATURES, Dash, TextOrDash } from "@/components/data-table/data-table";
import { CopyMenuItem, RowActionsMenu } from "@/components/data-table/row-actions-menu";
import { Monogram } from "@/components/monogram";
import { useCan } from "@/lib/membership";
import { ROLE_LABELS, type PartyListRow } from "@/lib/parties";

/** `balancePaise` is undefined while loading or without the report grant, null with no ledger line. */
export type PartyRow = PartyListRow & { balancePaise: bigint | null | undefined };

/** Sortable columns other than Name, which is the resting order. */
export const PARTY_SORTS = ["gstin", "balance"] as const;

const col = createColumnHelper<typeof DATA_TABLE_FEATURES, PartyRow>();

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
  // The statement's closing balance: receivable Dr, payable Cr. No ledger line sorts as
  // zero, so the column needs no undefined handling.
  col.accessor((party) => party.balancePaise ?? ZERO_MONEY, {
    id: "balance",
    header: "Balance",
    sortFn: "basic",
    sortDescFirst: true,
    meta: { align: "right", className: "w-32" },
    cell: ({ row: { original: party } }) => <Balance paise={party.balancePaise} />,
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

// Nothing stands in while balances load; "—" means no ledger line.
function Balance({ paise }: { paise: bigint | null | undefined }) {
  if (paise === undefined) return null;

  if (paise === null) return <Dash />;

  return <span className="tabular-nums">{formatBalance(paise)}</span>;
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
        {party.balancePaise == null ? null : (
          <span className="shrink-0 tabular-nums">{formatBalance(party.balancePaise)}</span>
        )}
      </div>
      <p className="truncate text-muted-foreground">
        {party.roles.map((role) => ROLE_LABELS[role]).join(", ")}
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
      <DropdownMenuItem
        render={
          <Link
            to="/$orgSlug/parties/$partyId/transactions"
            params={{ orgSlug, partyId: party.id }}
          />
        }
      >
        View transactions
      </DropdownMenuItem>
      {party.gstin ? (
        <CopyMenuItem text={party.gstin} copied="GSTIN copied">
          Copy GSTIN
        </CopyMenuItem>
      ) : null}
    </>
  );
}
