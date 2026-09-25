import type { AccountType, SupplyClass } from "@accly/db/schema/accounts";
import { Badge } from "@accly/ui/components/badge";
import { createColumnHelper } from "@tanstack/react-table";
import { LockIcon } from "lucide-react";

import { DATA_TABLE_FEATURES, TextOrDash } from "@/components/data-table/data-table";
import type { AccountRow } from "@/lib/accounts";

export const ACCOUNT_TYPE_LABELS = {
  asset: "Asset",
  liability: "Liability",
  equity: "Equity",
  income: "Income",
  expense: "Expense",
} satisfies Record<AccountType, string>;

export const SUPPLY_CLASS_LABELS: Record<SupplyClass, string> = {
  taxable: "Taxable",
  exempt: "Exempt",
  nil: "Nil-rated",
  nonGst: "Non-GST",
  notASupply: "Not a supply",
};

const col = createColumnHelper<typeof DATA_TABLE_FEATURES, AccountRow>();

function AccountName({ account }: { account: AccountRow }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {account.systemKey !== null ? (
        <LockIcon aria-label="System account" className="size-3.5 shrink-0 text-muted-foreground" />
      ) : null}
      <span className="truncate font-medium" title={account.name}>
        {account.name}
      </span>
    </span>
  );
}

export const ACCOUNT_COLUMNS = [
  col.accessor("name", {
    header: "Name",
    enableSorting: false,
    enableHiding: false,
    cell: ({ row: { original: account } }) => <AccountName account={account} />,
  }),
  col.display({
    id: "parent",
    header: "Parent ledger",
    enableSorting: false,
    meta: { className: "w-40" },
    cell: ({ row }) => <TextOrDash value={row.original.parentName ?? "Root ledger"} />,
  }),
  col.accessor("code", {
    header: "Code",
    enableSorting: false,
    meta: { className: "w-28" },
    cell: ({ getValue }) => <span className="font-mono">{getValue()}</span>,
  }),
  col.accessor("type", {
    header: "Type",
    enableSorting: false,
    meta: { className: "w-32" },
    cell: ({ getValue }) => ACCOUNT_TYPE_LABELS[getValue()],
  }),
  col.accessor("supplyClass", {
    header: "Supply class",
    enableSorting: false,
    meta: { className: "hidden w-32 lg:table-cell" },
    cell: ({ getValue }) => {
      const supplyClass = getValue();

      return <TextOrDash value={supplyClass ? SUPPLY_CLASS_LABELS[supplyClass] : null} />;
    },
  }),
  col.accessor("active", {
    header: "Status",
    enableSorting: false,
    meta: { className: "hidden w-24 lg:table-cell" },
    cell: ({ getValue }) => (
      <Badge variant={getValue() ? "secondary" : "muted"}>
        {getValue() ? "Active" : "Inactive"}
      </Badge>
    ),
  }),
];

export function AccountCard({ account }: { account: AccountRow }) {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <AccountName account={account} />
        <span className="shrink-0 font-mono">{account.code}</span>
      </div>
      <div className="flex items-center justify-between gap-3 text-muted-foreground">
        <span>{ACCOUNT_TYPE_LABELS[account.type]}</span>
        <span className="min-w-0 truncate">{account.parentName ?? "Root ledger"}</span>
        <Badge variant={account.active ? "secondary" : "muted"}>
          {account.active ? "Active" : "Inactive"}
        </Badge>
      </div>
      {account.supplyClass ? (
        <p className="text-muted-foreground">
          GST supply class: {SUPPLY_CLASS_LABELS[account.supplyClass]}
        </p>
      ) : null}
    </>
  );
}
