import { formatMoney } from "@accly/api/core/money";
import { searchQuery } from "@accly/api/lib/schemas";
import { Badge } from "@accly/ui/components/badge";
import { Button } from "@accly/ui/components/button";
import { cn } from "@accly/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createColumnHelper } from "@tanstack/react-table";
import { useRef } from "react";
import { z } from "zod";

import { DataTable, DATA_TABLE_FEATURES, TextOrDash } from "@/components/data-table/data-table";
import { TableEmpty } from "@/components/data-table/table-empty";
import { ItemSheet } from "@/components/item-sheet";
import { focusSearch } from "@/components/list-filter";
import { ListToolbar, PageBody, PageHeader, SearchInput } from "@/components/page";
import { itemListOptions, type ItemListRow } from "@/lib/items";
import { filterLinkItems } from "@/lib/link-rows";
import { useCan } from "@/lib/membership";
import { focusRowLink } from "@/lib/row-focus";
import { requireOrgPermission } from "@/lib/route-permission";

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
];

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
      <p className="truncate text-muted-foreground">
        {[item.hsnSac, item.unit, item.incomeAccountName, item.taxCode].filter(Boolean).join(" · ")}
      </p>
    </>
  );
}

export const Route = createFileRoute("/$orgSlug/items")({
  head: () => ({ meta: [{ title: "Items · Accly Books" }] }),
  validateSearch: z.object({
    q: searchQuery.catch(undefined),
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
  const { q, create, edit } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const field = useRef<HTMLDivElement>(null);
  const newTrigger = useRef<HTMLButtonElement>(null);
  const canCreate = useCan(orgSlug, { item: ["create"] });
  const canUpdate = useCan(orgSlug, { item: ["update"] });
  const items = useQuery(itemListOptions(orgSlug));
  const allItems = items.data ?? [];

  const rows = filterLinkItems(
    allItems,
    q ?? "",
    (item) => item.name,
    (item) => item.hsnSac ?? undefined,
  );

  const openItem = edit ? allItems.find((item) => item.id === edit) : undefined;

  const setQuery = (next: string | undefined) =>
    navigate({ replace: true, search: (previous) => ({ ...previous, q: next }) });

  const clearSearch = () => {
    focusSearch(field, { empty: true });
    void setQuery(undefined);
  };

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
      <PageBody>
        <ListToolbar>
          <SearchInput
            label="Search items"
            placeholder="Name or HSN/SAC"
            value={q}
            delay={150}
            fieldRef={field}
            onQueryChange={(next) => void setQuery(next || undefined)}
          />
        </ListToolbar>
        <DataTable
          columns={ITEM_COLUMNS}
          data={rows}
          getRowId={(item) => item.id}
          meta={{ orgSlug }}
          rowLink={
            canUpdate
              ? (item) => ({
                  to: "/$orgSlug/items",
                  params: { orgSlug },
                  search: { q, edit: item.id },
                })
              : undefined
          }
          renderCard={(item) => <ItemCard item={item} />}
          query={items}
          errorTitle="Could not load items"
          empty={
            q !== undefined ? (
              <TableEmpty
                title="No items match"
                description="Try another search."
                action={
                  <Button size="xs" variant="outline" onClick={clearSearch}>
                    Clear search
                  </Button>
                }
              />
            ) : (
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
            )
          }
          activeRowId={edit}
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
