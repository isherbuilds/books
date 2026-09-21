import { searchQuery } from "@accly/api/lib/schemas";
import { Button } from "@accly/ui/components/button";
import { DropdownMenuCheckboxItem } from "@accly/ui/components/dropdown-menu";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Outlet, createFileRoute, useMatch, useNavigate } from "@tanstack/react-router";
import { CalendarIcon, CircleDotIcon } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";

import { DataTable } from "@/components/data-table/data-table";
import { TableEmpty } from "@/components/data-table/table-empty";
import { JOURNAL_COLUMNS, JournalCard } from "@/components/journal-columns";
import { JournalOverlay } from "@/components/journal-overlay";
import {
  DateRangePopover,
  FilterChips,
  FilterMenu,
  FilterSubmenu,
  PresetItems,
  focusSearch,
  type ActiveFilter,
} from "@/components/list-filter";
import { ListToolbar, LoadMore, PageBody, PageHeader, SearchInput } from "@/components/page";
import { usePaletteActions } from "@/components/palette/use-palette-actions";
import { rangeLabel, type SearchRange } from "@/lib/date-presets";
import { journalListOptions } from "@/lib/journals";
import { useCan } from "@/lib/membership";
import { OPERATIONAL_INFINITE_REFETCH } from "@/lib/operational-query";
import { useOrgDateTime } from "@/lib/org-datetime";

const JOURNAL_STATES = ["posted", "cancelled"] as const;

const STATE_LABELS = { posted: "Posted", cancelled: "Cancelled" } as const;

const journalSearch = z.object({
  create: z.boolean().optional().catch(undefined),
  q: searchQuery.catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  state: z.enum(JOURNAL_STATES).optional().catch(undefined),
});

type JournalFilters = Omit<z.infer<typeof journalSearch>, "create">;

export const Route = createFileRoute("/$orgSlug/journals")({
  head: () => ({ meta: [{ title: "Journals · Accly Books" }] }),
  validateSearch: journalSearch,
  loaderDeps: ({ search: { create: _create, ...filters } }) => filters,
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    await queryClient.infiniteQuery(journalListOptions(orgSlug, deps)).catch(() => {});
  },
  component: JournalsRoute,
});

function JournalsRoute() {
  const { orgSlug } = Route.useParams();
  const { create, ...filters } = Route.useSearch();
  const { q, from, to, state } = filters;
  const { today, financialYearStart } = useOrgDateTime();
  const navigate = useNavigate({ from: Route.fullPath });
  const field = useRef<HTMLDivElement>(null);
  const newTrigger = useRef<HTMLButtonElement>(null);
  const [customRangeOpen, setCustomRangeOpen] = useState(false);
  const canPost = useCan(orgSlug, { journal: ["post"] });
  const range: SearchRange = { from, to };
  const rangeText = rangeLabel(range, today, financialYearStart);

  const journals = useInfiniteQuery({
    ...journalListOptions(orgSlug, filters),
    ...OPERATIONAL_INFINITE_REFETCH,
  });

  const activeRowId = useMatch({ from: "/$orgSlug/journals/$journalId", shouldThrow: false })
    ?.params.journalId;

  const rows = journals.data?.pages.flatMap((page) => page.rows) ?? [];

  const setFilters = (patch: Partial<JournalFilters>) =>
    navigate({ replace: true, search: (previous) => ({ ...previous, ...patch }) });

  const clear = () => {
    focusSearch(field, { empty: true });
    void setFilters({ q: undefined, from: undefined, to: undefined, state: undefined });
  };

  const chips: ActiveFilter[] = [];

  if (from || to) {
    chips.push({
      id: "date",
      name: "Date",
      label: rangeText,
      remove: () => setFilters({ from: undefined, to: undefined }),
    });
  }

  if (state) {
    chips.push({
      id: "state",
      name: "State",
      label: STATE_LABELS[state],
      remove: () => setFilters({ state: undefined }),
    });
  }

  const openCreate = () => void navigate({ search: (previous) => ({ ...previous, create: true }) });

  usePaletteActions(
    canPost ? [{ id: "journal:new", label: "New journal", group: "action", run: openCreate }] : [],
  );

  const closeOverlay = () =>
    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, create: undefined }),
    }).then(() => newTrigger.current?.focus());

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
        action={
          canPost ? (
            <Button ref={newTrigger} onClick={openCreate}>
              New
            </Button>
          ) : undefined
        }
      />

      <PageBody>
        <ListToolbar>
          <SearchInput
            label="Search journals"
            placeholder="Search number, reference, narration"
            value={q}
            fieldRef={field}
            onQueryChange={(next) => void setFilters({ q: next || undefined })}
            trailing={
              <FilterMenu anchor={field} active={chips.length > 0}>
                <FilterSubmenu icon={CalendarIcon} label={rangeText}>
                  <PresetItems
                    range={range}
                    today={today}
                    financialYearStart={financialYearStart}
                    onSelect={(next) => void setFilters(next)}
                    onCustom={() => setCustomRangeOpen(true)}
                  />
                </FilterSubmenu>
                <FilterSubmenu icon={CircleDotIcon} label="State">
                  {JOURNAL_STATES.map((each) => (
                    <DropdownMenuCheckboxItem
                      key={each}
                      checked={state === each}
                      onCheckedChange={(checked) =>
                        void setFilters({ state: checked ? each : undefined })
                      }
                    >
                      {STATE_LABELS[each]}
                    </DropdownMenuCheckboxItem>
                  ))}
                </FilterSubmenu>
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
            search: (previous) => ({ ...previous, create: undefined }),
          })}
          renderCard={(journal) => <JournalCard journal={journal} />}
          query={journals}
          errorTitle="Could not load journals"
          empty={empty}
          activeRowId={activeRowId}
        />
        <LoadMore query={journals} shown={rows.length} />
        <Outlet />
      </PageBody>

      <DateRangePopover
        open={customRangeOpen}
        onOpenChange={setCustomRangeOpen}
        anchor={field}
        from={from}
        to={to}
        today={today}
        onApply={(next) => void setFilters(next)}
      />

      {canPost ? (
        <JournalOverlay
          orgSlug={orgSlug}
          today={today}
          open={create === true}
          onClose={closeOverlay}
        />
      ) : null}
    </>
  );
}
