import { formatMoney } from "@accly/api/core/money";
import { Badge } from "@accly/ui/components/badge";
import { Button } from "@accly/ui/components/button";
import { DropdownMenuItem } from "@accly/ui/components/dropdown-menu";
import { cn } from "@accly/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { createColumnHelper } from "@tanstack/react-table";
import { useRef } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { DataTable, DATA_TABLE_FEATURES, TextOrDash } from "@/components/data-table/data-table";
import { RowActionsMenu } from "@/components/data-table/row-actions-menu";
import { TableEmpty } from "@/components/data-table/table-empty";
import { ItemSheet } from "@/components/item-sheet";
import { PageBody, PageHeader } from "@/components/page";
import { invalidateItems } from "@/lib/domain-invalidation";
import { itemListOptions, type ItemListRow } from "@/lib/items";
import { useCan } from "@/lib/membership";
import { errorMessage } from "@/lib/orpc-error";
import { orpc } from "@/lib/orpc";
import { focusRowLink } from "@/lib/row-focus";
import { requireOrgPermission } from "@/lib/route-permission";

import { SettingsTabs } from "./route";

const col = createColumnHelper<typeof DATA_TABLE_FEATURES, ItemListRow>();

const ITEM_COLUMNS = [
  col.accessor("name", {
    header: "Name",
    enableSorting: false,
    enableHiding: false,
    cell: ({ row: { original: item } }) => (
      <span
        className={cn("truncate font-medium", !item.active && "text-muted-foreground")}
        title={item.name}
      >
        {item.name}
      </span>
    ),
  }),
  col.accessor("hsnSac", {
    header: "HSN/SAC",
    enableSorting: false,
    meta: { className: "w-28" },
    cell: ({ getValue }) => <TextOrDash value={getValue()} mono />,
  }),
  col.accessor("unit", {
    header: "Unit",
    enableSorting: false,
    meta: { className: "hidden w-24 lg:table-cell" },
    cell: ({ getValue }) => <TextOrDash value={getValue()} />,
  }),
  col.accessor("unitPricePaise", {
    header: "Price",
    enableSorting: false,
    meta: { align: "right", className: "w-32" },
    cell: ({ getValue }) => <span className="tabular-nums">{formatMoney(getValue())}</span>,
  }),
  col.accessor("incomeAccountName", {
    header: "Income account",
    enableSorting: false,
    meta: { className: "hidden w-48 xl:table-cell" },
    cell: ({ getValue }) => (
      <span className="block truncate" title={getValue()}>
        {getValue()}
      </span>
    ),
  }),
  col.accessor("taxCode", {
    header: "Tax code",
    enableSorting: false,
    meta: { className: "hidden w-28 lg:table-cell" },
    cell: ({ getValue }) => <TextOrDash value={getValue()} mono />,
  }),
  col.accessor("active", {
    header: "State",
    enableSorting: false,
    meta: { className: "w-24" },
    cell: ({ getValue }) => (
      <Badge variant={getValue() ? "secondary" : "muted"}>
        {getValue() ? "Active" : "Archived"}
      </Badge>
    ),
  }),
  col.display({
    id: "actions",
    enableHiding: false,
    enableSorting: false,
    header: () => <span className="sr-only">Actions</span>,
    meta: { className: "w-10 px-1 text-center" },
    cell: ({ row, table }) => {
      const orgSlug = table.options.meta?.orgSlug;

      return orgSlug ? <ItemRowActions orgSlug={orgSlug} item={row.original} /> : null;
    },
  }),
];

function ItemRowActions({ orgSlug, item }: { orgSlug: string; item: ItemListRow }) {
  const canUpdate = useCan(orgSlug, { item: ["update"] });
  const queryClient = useQueryClient();

  const setActive = useMutation(
    orpc.item.setActive.mutationOptions({
      onSuccess: async () => {
        await invalidateItems(queryClient, orgSlug);
        toast.success(item.active ? "Item archived" : "Item restored");
      },
      onError: (error) => toast.error(errorMessage(error, "Could not update the item")),
    }),
  );

  if (!canUpdate) return null;

  return (
    <RowActionsMenu label={`Actions for ${item.name}`}>
      <DropdownMenuItem
        render={
          <Link to="/$orgSlug/settings/items" params={{ orgSlug }} search={{ edit: item.id }} />
        }
      >
        Edit
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={setActive.isPending}
        onClick={() => setActive.mutate({ orgSlug, itemId: item.id, active: !item.active })}
      >
        {item.active ? "Archive" : "Restore"}
      </DropdownMenuItem>
    </RowActionsMenu>
  );
}

function ItemCard({ item }: { item: ItemListRow }) {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("truncate font-medium", !item.active && "text-muted-foreground")}>
            {item.name}
          </span>
          {item.active ? null : <Badge variant="muted">Archived</Badge>}
        </span>
        <span className="shrink-0 tabular-nums">{formatMoney(item.unitPricePaise)}</span>
      </div>
      <p className="mt-1 truncate text-muted-foreground">
        {[item.hsnSac, item.unit, item.incomeAccountName, item.taxCode].filter(Boolean).join(" · ")}
      </p>
    </>
  );
}

export const Route = createFileRoute("/$orgSlug/settings/items")({
  head: () => ({ meta: [{ title: "Items · Accly Books" }] }),
  validateSearch: z.object({
    create: z.boolean().optional().catch(undefined),
    edit: z.uuid().optional().catch(undefined),
  }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { item: ["read"] });
    await queryClient.query(itemListOptions(orgSlug)).catch(() => {});
  },
  component: ItemsRoute,
});

function ItemsRoute() {
  const { orgSlug } = Route.useParams();
  const { create, edit } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const newTrigger = useRef<HTMLButtonElement>(null);
  const canCreate = useCan(orgSlug, { item: ["create"] });
  const canUpdate = useCan(orgSlug, { item: ["update"] });
  const items = useQuery(itemListOptions(orgSlug));
  const rows = items.data ?? [];
  const openItem = edit ? rows.find((item) => item.id === edit) : undefined;

  const openCreate = () =>
    void navigate({ search: (previous) => ({ ...previous, create: true, edit: undefined }) });

  const closeSheet = () => {
    const editedId = edit;
    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, create: undefined, edit: undefined }),
    }).then(() => {
      if (editedId) focusRowLink(editedId);
      else newTrigger.current?.focus();
    });
  };

  return (
    <>
      <PageHeader
        title="Items"
        description="Products and services used on invoices"
        action={
          canCreate ? (
            <Button ref={newTrigger} onClick={openCreate}>
              Add item
            </Button>
          ) : undefined
        }
      />
      <SettingsTabs orgSlug={orgSlug} />
      <PageBody>
        <DataTable
          columns={ITEM_COLUMNS}
          data={rows}
          getRowId={(item) => item.id}
          meta={{ orgSlug }}
          rowLink={(item) =>
            canUpdate
              ? {
                  to: "/$orgSlug/settings/items",
                  params: { orgSlug },
                  search: { edit: item.id },
                }
              : { to: "/$orgSlug/settings/items", params: { orgSlug } }
          }
          renderCard={(item) => <ItemCard item={item} />}
          query={items}
          errorTitle="Could not load items"
          empty={
            <TableEmpty
              title="No items yet"
              description="Items you add appear here for use on invoices."
              action={
                canCreate ? (
                  <Button size="xs" variant="outline" onClick={openCreate}>
                    Add item
                  </Button>
                ) : undefined
              }
            />
          }
          activeRowId={canUpdate ? edit : undefined}
        />
      </PageBody>

      {(create && canCreate) || (openItem && canUpdate) ? (
        <ItemSheet
          key={openItem?.id ?? "new"}
          orgSlug={orgSlug}
          item={openItem}
          onClose={closeSheet}
        />
      ) : null}
    </>
  );
}
