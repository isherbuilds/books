// Copyright (c) Midday Labs AB, AGPL-3.0, from midday-ai/midday@51587319f26a0ffaa9dfccab1920373cb65689b7
// Adapted from apps/dashboard/src/components/tables/customers/{data-table,table-header}.tsx,
// tables/core/virtual-row.tsx and transactions/data-table.tsx (the ↑/↓ record step).
import { cn } from "@accly/ui/lib/utils";
import { Link, useNavigate, type LinkOptions } from "@tanstack/react-router";
import {
  columnVisibilityFeature,
  constructSortFn,
  createSortedRowModel,
  flexRender,
  metaHelper,
  rowSortingFeature,
  sortFn_basic,
  tableFeatures,
  useTable,
  type Cell,
  type ColumnVisibilityState,
  type ColumnDef,
  type OnChangeFn,
  type RowData,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import {
  useDesktop,
  useVirtualRows,
  type VirtualPage,
} from "@/components/data-table/use-virtual-rows";
import { ListFooter, ListState } from "@/components/page";

type DataTableColumnMeta = {
  /** Width and responsive visibility, applied to the th and every td. */
  className?: string;
  align?: "right";
};

const collator = new Intl.Collator("en-IN", { sensitivity: "base", numeric: true });

const collated = constructSortFn({
  sort: (left, right) => collator.compare(String(left), String(right)),
});

// Only sorting and column visibility ship; column files type their helpers with it.
export const DATA_TABLE_FEATURES = tableFeatures({
  columnVisibilityFeature,
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic, collated },
  columnMeta: metaHelper<DataTableColumnMeta>(),
  tableMeta: metaHelper<{ orgSlug: string }>(),
});

const NO_SORTING: SortingState = [];

const ALL_VISIBLE: ColumnVisibilityState = {};

const ARIA_SORT = { asc: "ascending", desc: "descending" } as const;

type RowLink<T> = (row: T) => LinkOptions;

/**
 * The one list table: a flat bordered box, a sticky header, single-line rows that
 * open their record through a real link, and a card per row below `md`.
 */
export function DataTable<T extends RowData>({
  columns,
  data,
  getRowId,
  meta,
  rowLink,
  renderCard,
  query,
  errorTitle,
  empty,
  sorting,
  onSortingChange,
  columnVisibility,
  activeRowId,
}: {
  /** A module constant: react-table rebuilds its row model when this changes. */
  columns: ColumnDef<typeof DATA_TABLE_FEATURES, T, any>[];
  data: T[];
  getRowId: (row: T) => string;
  meta: { orgSlug: string };
  rowLink?: RowLink<T>;
  renderCard: (row: T) => ReactNode;
  /** A `useInfiniteQuery` result also grows the list and gets the paging footer. */
  query: ComponentProps<typeof ListState>["query"] & Partial<VirtualPage>;
  errorTitle: string;
  empty: ReactNode;
  /** Omit for a list whose order the server fixes: no header is sortable. */
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  columnVisibility?: ColumnVisibilityState;
  /** The open record's id, from the child route. */
  activeRowId?: string;
}) {
  const table = useTable({
    features: DATA_TABLE_FEATURES,
    data,
    columns,
    getRowId,
    meta,
    enableSorting: sorting !== undefined,
    // The resting order is a sort too: a header click flips it, never clears it.
    enableSortingRemoval: false,
    state: { sorting: sorting ?? NO_SORTING, columnVisibility: columnVisibility ?? ALL_VISIBLE },
    onSortingChange,
  });

  const rows = table.getRowModel().rows;
  const hasRows = rows.length > 0;
  const pendingFocus = useRef<{ list: HTMLElement; index: number } | null>(null);
  const desktop = useDesktop();

  const nextPage: VirtualPage | undefined = query.fetchNextPage
    ? {
        hasNextPage: query.hasNextPage ?? false,
        isFetchingNextPage: query.isFetchingNextPage ?? false,
        isFetching: query.isFetching ?? false,
        isFetchNextPageError: query.isFetchNextPageError ?? false,
        fetchNextPage: query.fetchNextPage,
      }
    : undefined;

  const tableRows = useVirtualRows<HTMLTableSectionElement>({
    count: rows.length,
    estimateSize: 40,
    getItemKey: (index) => rows[index]!.id,
    enabled: desktop !== false,
    nextPage: desktop === true ? nextPage : undefined,
  });

  const cards = useVirtualRows<HTMLUListElement, HTMLLIElement>({
    count: rows.length,
    estimateSize: 72,
    getItemKey: (index) => rows[index]!.id,
    enabled: desktop !== true,
    nextPage: desktop === false ? nextPage : undefined,
  });

  const tableFirst = tableRows.virtualRows[0]?.index;
  const tableLast = tableRows.virtualRows.at(-1)?.index;
  const cardFirst = cards.virtualRows[0]?.index;
  const cardLast = cards.virtualRows.at(-1)?.index;

  useLayoutEffect(() => {
    const pending = pendingFocus.current;

    if (!pending) return;

    const link = pending.list.querySelector<HTMLElement>(
      `[data-index="${pending.index}"] [data-row-link]`,
    );

    if (link) {
      link.focus();
      pendingFocus.current = null;
    }
  }, [tableFirst, tableLast, cardFirst, cardLast]);

  return (
    // The box hugs its rows, so a short list ends on its last row's line; only the
    // empty and loading states hold the panel height (design.md §9).
    <div
      className={cn(
        "flex flex-col overflow-clip rounded-lg border border-border bg-card",
        !hasRows && "min-h-64",
      )}
    >
      {desktop !== false ? (
        <table
          className={cn(
            "w-full table-fixed border-separate border-spacing-0 text-sm",
            desktop === undefined && "hidden md:table",
          )}
        >
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const columnMeta = header.column.columnDef.meta;
                  const sortable = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();

                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={sortable ? (sorted ? ARIA_SORT[sorted] : "none") : undefined}
                      className={cn(
                        // -top-4 cancels PageBody's p-4: at top-0 the header would stick
                        // at the scrollport's padding edge and rows would scroll through
                        // the 1rem band above it.
                        "sticky -top-4 z-10 h-10 border-r border-b border-border border-r-border/60 bg-muted px-3 text-left align-middle text-xs font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase last:border-r-0",
                        columnMeta?.align === "right" && "text-right",
                        columnMeta?.className,
                      )}
                    >
                      {sortable ? (
                        <SortButton
                          label={flexRender(header.column.columnDef.header, header.getContext())}
                          sorted={sorted}
                          onClick={header.column.getToggleSortingHandler()}
                        />
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          {hasRows ? (
            <tbody
              ref={tableRows.listRef}
              onKeyDown={(event) =>
                moveRowFocus(event, rows.length, tableRows.scrollToIndex, pendingFocus)
              }
              className="[&>tr:last-child>td]:border-b-0"
            >
              {tableRows.paddingTop > 0 ? (
                <tr aria-hidden="true" style={{ height: tableRows.paddingTop }}>
                  {/* A colspan counts columns hidden by CSS and leaves a blank track. */}
                  <td className="p-0" />
                </tr>
              ) : null}
              {tableRows.virtualRows.map((item) => {
                const row = rows[item.index]!;

                return (
                  <DataTableRow
                    key={row.id}
                    index={item.index}
                    id={row.id}
                    original={row.original}
                    cells={row.getVisibleCells()}
                    active={row.id === activeRowId}
                    rowLink={rowLink}
                  />
                );
              })}
              {tableRows.paddingBottom > 0 ? (
                <tr aria-hidden="true" style={{ height: tableRows.paddingBottom }}>
                  <td className="p-0" />
                </tr>
              ) : null}
            </tbody>
          ) : null}
        </table>
      ) : null}
      {hasRows && desktop !== true ? (
        <ul
          ref={cards.listRef}
          onKeyDown={(event) => moveRowFocus(event, rows.length, cards.scrollToIndex, pendingFocus)}
          className="md:hidden"
        >
          {cards.paddingTop > 0 ? (
            <li aria-hidden="true" style={{ height: cards.paddingTop }} />
          ) : null}
          {cards.virtualRows.map((item) => {
            const row = rows[item.index]!;

            return (
              <li
                key={row.id}
                data-index={item.index}
                ref={cards.measureElement}
                data-row-id={row.id}
                className="[&:last-child>*]:border-b-0"
              >
                {rowLink ? (
                  <Link
                    {...rowLink(row.original)}
                    data-row-link
                    data-focus-inset
                    data-active={row.id === activeRowId || undefined}
                    className={cn(CARD_CLASS, "scroll-mt-2 data-active:bg-muted")}
                  >
                    {renderCard(row.original)}
                  </Link>
                ) : (
                  <div className={CARD_CLASS}>{renderCard(row.original)}</div>
                )}
              </li>
            );
          })}
          {cards.paddingBottom > 0 ? (
            <li aria-hidden="true" style={{ height: cards.paddingBottom }} />
          ) : null}
        </ul>
      ) : null}
      <ListState query={query} errorTitle={errorTitle} isEmpty={!hasRows} empty={empty}>
        {null}
      </ListState>
      {nextPage ? <ListFooter query={nextPage} shown={rows.length} /> : null}
    </div>
  );
}

const CARD_CLASS = "flex min-h-10 flex-col gap-1 border-b border-border/60 px-3 py-2 text-sm";

// A compiled child: it receives plain values only, never the table or row objects,
// so a memoized row cannot render stale after a sort or a visibility change.
function DataTableRow<T extends RowData>({
  id,
  index,
  original,
  cells,
  active,
  rowLink,
}: {
  id: string;
  index: number;
  original: T;
  cells: Cell<typeof DATA_TABLE_FEATURES, T, unknown>[];
  active: boolean;
  rowLink?: RowLink<T>;
}) {
  const navigate = useNavigate();

  return (
    <tr
      data-row-id={id}
      data-index={index}
      data-active={active || undefined}
      onClick={(event) => {
        if (!rowLink) return;

        const target = event.target;

        // React bubbles clicks from the portaled row menu through this row.
        if (!(target instanceof Element) || !event.currentTarget.contains(target)) return;

        // The link and the menu trigger handle their own clicks.
        if (target.closest("a, button, input, [role=menuitem]")) return;

        // Selecting cell text to copy it is not a request to open the record.
        if (window.getSelection()?.type === "Range") return;

        void navigate(rowLink(original));
      }}
      className={cn(
        "group h-10 data-active:bg-accent has-[a[data-row-link]:focus-visible]:bg-accent hover:bg-accent/70",
        rowLink && "cursor-pointer",
      )}
    >
      {cells.map((cell, index) => {
        const columnMeta = cell.column.columnDef.meta;
        const content = flexRender(cell.column.columnDef.cell, cell.getContext());

        return (
          <td
            key={cell.id}
            className={cn(
              "truncate border-r border-b border-border/60 px-3 align-middle last:border-r-0",
              columnMeta?.align === "right" && "text-right",
              columnMeta?.className,
            )}
          >
            {index === 0 && rowLink ? (
              <Link
                {...rowLink(original)}
                data-row-link
                className="flex min-w-0 scroll-mt-12 items-center gap-2 font-medium"
              >
                {content}
              </Link>
            ) : (
              content
            )}
          </td>
        );
      })}
    </tr>
  );
}

// Midday's ghost sort label: the arrow shows only on the sorted column. A plain
// button, because the shared Button's press scale would animate a frequent action.
function SortButton({
  label,
  sorted,
  onClick,
}: {
  label: ReactNode;
  sorted: false | "asc" | "desc";
  onClick?: (event: unknown) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex max-w-full items-center gap-1 rounded-sm hover:text-foreground"
    >
      <span className="truncate">{label}</span>
      {sorted === "asc" ? <ArrowDownIcon aria-hidden className="size-3.5 shrink-0" /> : null}
      {sorted === "desc" ? <ArrowUpIcon aria-hidden className="size-3.5 shrink-0" /> : null}
    </button>
  );
}

export function Dash() {
  return <span className="text-muted-foreground">—</span>;
}

export function TextOrDash({ value, mono = false }: { value: string | null; mono?: boolean }) {
  if (!value) return <Dash />;

  return (
    <span title={value} className={cn(mono && "font-mono")}>
      {value}
    </span>
  );
}

// DOM focus only: moving between row links commits nothing to React.
function moveRowFocus(
  event: KeyboardEvent<HTMLElement>,
  count: number,
  scrollToIndex: (index: number) => void,
  pendingFocus: RefObject<{ list: HTMLElement; index: number } | null>,
) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

  const active = document.activeElement;

  if (!(active instanceof HTMLElement) || !active.matches("[data-row-link]")) return;

  if (!event.currentTarget.contains(active)) return;

  const row = active.closest<HTMLElement>("[data-index]");

  if (!row) return;

  const index = Number(row.dataset.index) + (event.key === "ArrowDown" ? 1 : -1);
  event.preventDefault();

  if (index < 0 || index >= count) return;

  const next = event.currentTarget.querySelector<HTMLElement>(
    `[data-index="${index}"] [data-row-link]`,
  );

  if (next) {
    next.focus();

    return;
  }

  pendingFocus.current = { list: event.currentTarget, index };
  scrollToIndex(index);
}
