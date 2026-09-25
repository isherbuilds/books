import { searchQuery } from "@accly/api/lib/schemas";
import { Button } from "@accly/ui/components/button";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CircleDotIcon } from "lucide-react";
import { useRef } from "react";
import { z } from "zod";

import { DataTable } from "@/components/data-table/data-table";
import { TableEmpty } from "@/components/data-table/table-empty";
import { JOURNAL_COLUMNS, JournalCard } from "@/components/journal-columns";
import { useDateRangeFilter } from "@/components/date-range-filter";
import {
  FilterChips,
  FilterMenu,
  focusSearch,
  type ActiveFilter,
  OptionFilter,
} from "@/components/list-filter";
import { ListToolbar, LoadMore, PageBody, PageHeader, SearchInput } from "@/components/page";
import { usePaletteActions } from "@/components/palette/use-palette-actions";
import { journalListOptions } from "@/lib/journals";
import { useCan } from "@/lib/membership";
import { OPERATIONAL_INFINITE_REFETCH } from "@/lib/operational-query";
import { requireOrgPermission } from "@/lib/route-permission";

const JOURNAL_STATES = ["posted", "cancelled"] as const;

const STATE_LABELS = { posted: "Posted", cancelled: "Cancelled" } as const;

const journalSearch = z.object({
  q: searchQuery.catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  state: z.enum(JOURNAL_STATES).optional().catch(undefined),
});

type JournalFilters = z.infer<typeof journalSearch>;

export const Route = createFileRoute("/$orgSlug/journals")({
  head: () => ({ meta: [{ title: "Journals · Accly Books" }] }),
  validateSearch: journalSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { journal: ["read"] });
    await queryClient.infiniteQuery(journalListOptions(orgSlug, deps)).catch(() => {});
  },
  component: JournalsRoute,
});

function JournalsRoute() {
  const { orgSlug } = Route.useParams();
  const filters = Route.useSearch();
  const { q, from, to, state } = filters;
  const navigate = useNavigate({ from: Route.fullPath });
  const field = useRef<HTMLDivElement>(null);
  const canPost = useCan(orgSlug, { journal: ["post"] });

  const journals = useInfiniteQuery({
    ...journalListOptions(orgSlug, filters),
    ...OPERATIONAL_INFINITE_REFETCH,
  });

  const rows = journals.data?.pages.flatMap((page) => page.rows) ?? [];

  const setFilters = (patch: Partial<JournalFilters>) =>
    navigate({ replace: true, search: (previous) => ({ ...previous, ...patch }) });

  const date = useDateRangeFilter({ from, to }, field, (range) => setFilters(range));

  const clear = () => {
    focusSearch(field, { empty: true });
    void setFilters({ q: undefined, from: undefined, to: undefined, state: undefined });
  };

  const chips: ActiveFilter[] = [];

  if (date.chip) chips.push(date.chip);

  if (state) {
    chips.push({
      id: "state",
      name: "State",
      label: STATE_LABELS[state],
      remove: () => setFilters({ state: undefined }),
    });
  }

  const openCreate = () => void navigate({ to: "/$orgSlug/journals/new", params: { orgSlug } });

  usePaletteActions(
    canPost ? [{ id: "journal:new", label: "New journal", group: "action", run: openCreate }] : [],
  );

  const empty =
    q !== undefined || chips.length > 0 ? (
      <TableEmpty
        title="No journals match"
        description="Try another search or clear the filters."
        action={
          <Button size="xs" variant="outline" onClick={clear}>
            Clear filters
          </Button>
        }
      />
    ) : (
      <TableEmpty
        title="No journals yet"
        description="Post a journal to move balances between accounts."
        action={
          canPost ? (
            <Button size="xs" variant="outline" onClick={openCreate}>
              New journal
            </Button>
          ) : undefined
        }
      />
    );

  return (
    <>
      <PageHeader
        title="Journals"
        action={canPost ? <Button onClick={openCreate}>New</Button> : undefined}
      />

      <PageBody>
        <ListToolbar>
          <SearchInput
            label="Search journals"
            placeholder="Number, reference, or narration"
            value={q}
            fieldRef={field}
            onQueryChange={(next) => void setFilters({ q: next || undefined })}
            trailing={
              <FilterMenu anchor={field} active={chips.length > 0}>
                {date.submenu}
                <OptionFilter
                  icon={CircleDotIcon}
                  label="State"
                  options={JOURNAL_STATES}
                  labels={STATE_LABELS}
                  value={state}
                  onChange={(next) => void setFilters({ state: next })}
                />
              </FilterMenu>
            }
          />
          <FilterChips filters={chips} field={field} onClear={clear} />
        </ListToolbar>

        <DataTable
          columns={JOURNAL_COLUMNS}
          data={rows}
          getRowId={(journal) => journal.id}
          meta={{ orgSlug }}
          rowLink={(journal) => ({
            to: "/$orgSlug/journals/$journalId",
            params: { orgSlug, journalId: journal.id },
          })}
          renderCard={(journal) => <JournalCard journal={journal} />}
          query={journals}
          errorTitle="Could not load journals"
          empty={empty}
        />
        <LoadMore query={journals} shown={rows.length} />
      </PageBody>

      {date.popover}
    </>
  );
}
