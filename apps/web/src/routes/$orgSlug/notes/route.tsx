import { searchQuery } from "@accly/api/lib/schemas";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Outlet, createFileRoute, useMatch, useNavigate } from "@tanstack/react-router";
import { useRef } from "react";
import { z } from "zod";

import { DataTable } from "@/components/data-table/data-table";
import { RegisterEmpty } from "@/components/data-table/table-empty";
import { useDateRangeFilter } from "@/components/date-range-filter";
import {
  FilterChips,
  FilterMenu,
  focusSearch,
  usePartyChip,
  type ActiveFilter,
} from "@/components/list-filter";
import { NOTE_COLUMNS, NoteCard } from "@/components/note-columns";
import { ListToolbar, LoadMore, PageBody, PageHeader, SearchInput } from "@/components/page";
import { requireOrgPermission } from "@/lib/route-permission";
import { noteListOptions, NOTE_TYPE_LABELS } from "@/lib/notes";
import { OPERATIONAL_INFINITE_REFETCH } from "@/lib/operational-query";
import { periodSearch, requirePeriod } from "@/lib/require-period";

const noteSearch = z.object({
  q: searchQuery.catch(undefined),
  partyId: z.uuid().optional().catch(undefined),
  type: z.enum(["creditNote", "debitNote"]).optional().catch(undefined),
  ...periodSearch,
});

type NoteFilters = z.infer<typeof noteSearch>;

export const Route = createFileRoute("/$orgSlug/notes")({
  head: () => ({ meta: [{ title: "Notes · Accly Books" }] }),
  validateSearch: noteSearch,
  beforeLoad: ({ context: { queryClient }, location, params: { orgSlug }, search }) =>
    requirePeriod(queryClient, orgSlug, location, search, "this-year"),
  loaderDeps: ({ search: { all: _all, ...filters } }) => filters,
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { note: ["read"] });
    await queryClient.prefetchInfiniteQuery(noteListOptions(orgSlug, deps));
  },
  component: NotesRoute,
});

function NotesRoute() {
  const { orgSlug } = Route.useParams();
  const { all: _all, ...filters } = Route.useSearch();
  const { q, partyId, type, from, to } = filters;
  const navigate = useNavigate({ from: Route.fullPath });
  const field = useRef<HTMLDivElement>(null);

  const notes = useInfiniteQuery({
    ...noteListOptions(orgSlug, filters),
    ...OPERATIONAL_INFINITE_REFETCH,
  });

  const activeRowId = useMatch({ from: "/$orgSlug/notes/$noteId", shouldThrow: false })?.params
    .noteId;

  const rows = notes.data?.pages.flatMap((page) => page.rows) ?? [];

  const setFilters = (patch: Partial<NoteFilters>) =>
    navigate({ replace: true, search: (previous) => ({ ...previous, ...patch }) });

  const partyChip = usePartyChip(orgSlug, partyId, () => setFilters({ partyId: undefined }));

  const date = useDateRangeFilter({ from, to }, field, (range) => setFilters(range));

  const clear = () => {
    focusSearch(field, { empty: true });
    void navigate({ replace: true, search: { all: true } });
  };

  const chips: ActiveFilter[] = [];

  if (partyChip) chips.push(partyChip);

  if (date.chip) chips.push(date.chip);

  if (type)
    chips.push({
      id: "type",
      name: "Type",
      label: NOTE_TYPE_LABELS[type],
      remove: () => setFilters({ type: undefined }),
    });

  return (
    <>
      <PageHeader title="Notes" />
      <PageBody>
        <ListToolbar>
          <SearchInput
            label="Search notes"
            placeholder="Number, party, or reason"
            value={q}
            fieldRef={field}
            onQueryChange={(next) => void setFilters({ q: next || undefined })}
            trailing={
              <FilterMenu anchor={field} active={chips.length > 0}>
                {date.submenu}
              </FilterMenu>
            }
          />
          <FilterChips filters={chips} field={field} onClear={clear} />
        </ListToolbar>
        <DataTable
          columns={NOTE_COLUMNS}
          data={rows}
          getRowId={(note) => note.id}
          meta={{ orgSlug }}
          rowLink={(note) => ({
            to: "/$orgSlug/notes/$noteId",
            params: { orgSlug, noteId: note.id },
            search: (previous) => previous,
          })}
          // One type per register, so its column would repeat on every row.
          columnVisibility={type ? { type: false } : undefined}
          renderCard={(note) => <NoteCard note={note} showType={!type} />}
          query={notes}
          errorTitle="Could not load notes"
          empty={
            <RegisterEmpty
              noun="notes"
              filtered={q !== undefined || chips.length > 0}
              onClear={clear}
              description="Credit and debit notes posted against invoices and bills appear here."
            />
          }
          activeRowId={activeRowId}
        />
        <LoadMore query={notes} shown={rows.length} />
        <Outlet />
      </PageBody>
      {date.popover}
    </>
  );
}
