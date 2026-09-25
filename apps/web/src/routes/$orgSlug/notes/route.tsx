import { searchQuery } from "@accly/api/lib/schemas";
import { Button } from "@accly/ui/components/button";
import { DropdownMenuCheckboxItem } from "@accly/ui/components/dropdown-menu";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Outlet, createFileRoute, useMatch, useNavigate } from "@tanstack/react-router";
import { ContactRoundIcon, FilesIcon } from "lucide-react";
import { useRef } from "react";
import { z } from "zod";

import { DataTable } from "@/components/data-table/data-table";
import { TableEmpty } from "@/components/data-table/table-empty";
import { useDateRangeFilter } from "@/components/date-range-filter";
import {
  FilterChips,
  FilterMenu,
  FilterSubmenu,
  focusSearch,
  type ActiveFilter,
} from "@/components/list-filter";
import { PartyFilterItems } from "@/components/party-filter-items";
import { NOTE_COLUMNS, NoteCard } from "@/components/note-columns";
import { ListToolbar, LoadMore, PageBody, PageHeader, SearchInput } from "@/components/page";
import { useCan } from "@/lib/membership";
import { requireOrgPermission } from "@/lib/route-permission";
import { noteListOptions, NOTE_TYPE_LABELS } from "@/lib/notes";
import { OPERATIONAL_INFINITE_REFETCH } from "@/lib/operational-query";
import { partyListOptions } from "@/lib/parties";

const noteSearch = z.object({
  q: searchQuery.catch(undefined),
  partyId: z.uuid().optional().catch(undefined),
  type: z.enum(["creditNote", "debitNote"]).optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
});

type NoteFilters = z.infer<typeof noteSearch>;

export const Route = createFileRoute("/$orgSlug/notes")({
  head: () => ({ meta: [{ title: "Notes · Accly Books" }] }),
  validateSearch: noteSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { note: ["read"] });
    await queryClient.infiniteQuery(noteListOptions(orgSlug, deps)).catch(() => {});
  },
  component: NotesRoute,
});

function NotesRoute() {
  const { orgSlug } = Route.useParams();
  const filters = Route.useSearch();
  const { q, partyId, type, from, to } = filters;
  const navigate = useNavigate({ from: Route.fullPath });
  const field = useRef<HTMLDivElement>(null);
  const canReadParties = useCan(orgSlug, { party: ["read"] });

  const notes = useInfiniteQuery({
    ...noteListOptions(orgSlug, filters),
    ...OPERATIONAL_INFINITE_REFETCH,
  });

  const parties = useQuery({
    ...partyListOptions(orgSlug),
    enabled: canReadParties && partyId !== undefined,
  });

  const activeRowId = useMatch({ from: "/$orgSlug/notes/$noteId", shouldThrow: false })?.params
    .noteId;

  const rows = notes.data?.pages.flatMap((page) => page.rows) ?? [];

  const setFilters = (patch: Partial<NoteFilters>) =>
    navigate({ replace: true, search: (previous) => ({ ...previous, ...patch }) });

  const date = useDateRangeFilter({ from, to }, field, (range) => setFilters(range));

  const clear = () => {
    focusSearch(field, { empty: true });
    void setFilters({
      q: undefined,
      partyId: undefined,
      type: undefined,
      from: undefined,
      to: undefined,
    });
  };

  const chips: ActiveFilter[] = [];

  if (partyId) {
    const party = parties.data?.rows.find((candidate) => candidate.id === partyId);
    chips.push({
      id: "partyId",
      name: "Party",
      label: party ? `Party: ${party.name}` : "One party",
      remove: () => setFilters({ partyId: undefined }),
    });
  }

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
                {canReadParties ? (
                  <FilterSubmenu icon={ContactRoundIcon} label="Party">
                    <PartyFilterItems
                      orgSlug={orgSlug}
                      partyId={partyId}
                      onChange={(next) => void setFilters({ partyId: next })}
                    />
                  </FilterSubmenu>
                ) : null}
                <FilterSubmenu icon={FilesIcon} label={type ? NOTE_TYPE_LABELS[type] : "All notes"}>
                  <DropdownMenuCheckboxItem
                    checked={!type}
                    onCheckedChange={() => void setFilters({ type: undefined })}
                  >
                    All
                  </DropdownMenuCheckboxItem>
                  {(["creditNote", "debitNote"] as const).map((candidate) => (
                    <DropdownMenuCheckboxItem
                      key={candidate}
                      checked={type === candidate}
                      onCheckedChange={(checked) =>
                        void setFilters({ type: checked ? candidate : undefined })
                      }
                    >
                      {candidate === "creditNote" ? "Credit notes" : "Debit notes"}
                    </DropdownMenuCheckboxItem>
                  ))}
                </FilterSubmenu>
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
          renderCard={(note) => <NoteCard note={note} />}
          query={notes}
          errorTitle="Could not load notes"
          empty={
            q || chips.length ? (
              <TableEmpty
                title="No notes match"
                description="Try another search or clear the filters."
                action={
                  <Button size="xs" variant="outline" onClick={clear}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <TableEmpty
                title="No notes yet"
                description="Credit and debit notes posted against invoices and bills appear here."
              />
            )
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
