import { searchQuery } from "@accly/api/lib/schemas";
import { authorize } from "@accly/auth/access";
import { Button } from "@accly/ui/components/button";
import { DropdownMenuCheckboxItem } from "@accly/ui/components/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { functionalUpdate, type OnChangeFn, type SortingState } from "@tanstack/react-table";
import { BadgeCheckIcon, CircleDotIcon, TagsIcon } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";

import { DataTable } from "@/components/data-table/data-table";
import { TableEmpty } from "@/components/data-table/table-empty";
import {
  FilterChips,
  FilterMenu,
  FilterSubmenu,
  focusSearch,
  toggleValue,
  type ActiveFilter,
} from "@/components/list-filter";
import { ListToolbar, LoadMore, PageBody, PageHeader, SearchInput } from "@/components/page";
import { usePaletteActions } from "@/components/palette/use-palette-actions";
import { PARTY_COLUMNS, PARTY_SORTS, PartyCard, type PartyRow } from "@/components/party-columns";
import { PartySheet } from "@/components/party-form";
import { PartyQuickLook } from "@/components/party-quick-look";
import { membershipOptions, useCan } from "@/lib/membership";
import { focusRowLink } from "@/lib/row-focus";
import {
  GST_FILTERS,
  PARTY_ROLES,
  PARTY_STATUSES,
  ROLE_LABELS,
  filterParties,
  partyListOptions,
  partyTotalsOptions,
  type PartyFilters,
} from "@/lib/parties";

// The list is complete in the cache; the table mounts it 25 rows at a time, one Load
// more per step, the same page as the server keyset lists (lib/schemas `pageLimit`).
const ROW_STEP = 25;

const STATUS_LABELS = { active: "Active", inactive: "Inactive" } as const;

const GST_LABELS = { registered: "GST registered", unregistered: "No GSTIN" } as const;

export const Route = createFileRoute("/$orgSlug/parties")({
  head: () => ({ meta: [{ title: "Parties · Accly Books" }] }),
  validateSearch: z.object({
    create: z.boolean().optional().catch(undefined),
    // The quick look: one party opened over the list.
    party: z.uuid().optional().catch(undefined),
    q: searchQuery.catch(undefined),
    status: z.enum(PARTY_STATUSES).optional().catch(undefined),
    roles: z.array(z.enum(PARTY_ROLES)).min(1).optional().catch(undefined),
    gst: z.enum(GST_FILTERS).optional().catch(undefined),
    // Absent means Name ascending, the resting order.
    sort: z.enum(PARTY_SORTS).optional().catch(undefined),
    order: z.enum(["desc"]).optional().catch(undefined),
  }),
  // Filters and sort never refetch: the master is complete and cached.
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    const membership = await queryClient.query(membershipOptions(orgSlug));

    await Promise.all([
      queryClient.query(partyListOptions(orgSlug)).catch(() => {}),
      authorize(membership.roles, { receipt: ["read"] })
        ? queryClient.query(partyTotalsOptions(orgSlug)).catch(() => {})
        : undefined,
    ]);
  },
  component: PartiesRoute,
});

function PartiesRoute() {
  const { orgSlug } = Route.useParams();

  const { create, party: openPartyId, q, status, roles, gst, sort, order } = Route.useSearch();

  const navigate = useNavigate({ from: Route.fullPath });
  const field = useRef<HTMLDivElement>(null);
  const newTrigger = useRef<HTMLButtonElement>(null);
  const [limit, setLimit] = useState(ROW_STEP);
  const canCreate = useCan(orgSlug, { party: ["create"] });
  const canReadReceipts = useCan(orgSlug, { receipt: ["read"] });
  const parties = useQuery(partyListOptions(orgSlug));
  const totals = useQuery({ ...partyTotalsOptions(orgSlug), enabled: canReadReceipts });

  const master = parties.data ?? [];
  const openParty = openPartyId ? master.find((each) => each.id === openPartyId) : undefined;
  const totalsById = new Map(totals.data?.map((each) => [each.partyId, each]));

  const rows: PartyRow[] = filterParties(master, { q, status, roles, gst }).map((party) => ({
    ...party,
    totals: totals.data ? (totalsById.get(party.id) ?? null) : undefined,
  }));

  const setFilters = (patch: PartyFilters) =>
    navigate({ replace: true, search: (previous) => ({ ...previous, ...patch }) });

  // Both Clear buttons unmount once the filters go, so focus moves to the box first.
  const clear = () => {
    focusSearch(field, { empty: true });

    void setFilters({
      q: undefined,
      status: undefined,
      roles: undefined,
      gst: undefined,
    });
  };

  const sorting: SortingState = [{ id: sort ?? "name", desc: order === "desc" }];

  const onSortingChange: OnChangeFn<SortingState> = (updater) => {
    const [next] = functionalUpdate(updater, sorting);

    void navigate({
      replace: true,
      search: (previous) => ({
        ...previous,
        sort: PARTY_SORTS.find((id) => id === next?.id),
        order: next?.desc ? "desc" : undefined,
      }),
    });
  };

  const columnVisibility = { received: canReadReceipts };

  const chips: ActiveFilter[] = [];

  if (status) {
    chips.push({
      id: "status",
      name: "Status",
      label: STATUS_LABELS[status],
      remove: () => setFilters({ status: undefined }),
    });
  }

  if (roles) {
    chips.push({
      id: "roles",
      name: "Role",
      label: roles.map((role) => ROLE_LABELS[role]).join(", "),
      remove: () => setFilters({ roles: undefined }),
    });
  }

  if (gst) {
    chips.push({
      id: "gst",
      name: "GST",
      label: GST_LABELS[gst],
      remove: () => setFilters({ gst: undefined }),
    });
  }

  const openCreate = () => void navigate({ search: (previous) => ({ ...previous, create: true }) });

  usePaletteActions(
    canCreate ? [{ id: "party:new", label: "New party", group: "action", run: openCreate }] : [],
  );

  const closeCreate = () =>
    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, create: undefined }),
    }).then(() => newTrigger.current?.focus());

  // Replace, so Back leaves the list rather than reopening the party; focus returns
  // to the row the quick look came from.
  const closeQuickLook = () => {
    const id = openPartyId;

    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, party: undefined }),
    }).then(() => {
      if (id) focusRowLink(id);
    });
  };

  const showMore = () => setLimit((current) => current + ROW_STEP);
  const hasMore = rows.length > limit;

  const empty =
    q !== undefined || chips.length > 0 ? (
      <TableEmpty
        title="No parties match"
        description="Try another search or clear the filters."
        action={
          <Button size="xs" variant="outline" onClick={clear}>
            Clear filters
          </Button>
        }
      />
    ) : (
      <TableEmpty
        title="No parties yet"
        description="Parties you register appear here with their GSTIN."
        action={
          canCreate ? (
            <Button size="xs" variant="outline" onClick={openCreate}>
              New party
            </Button>
          ) : undefined
        }
      />
    );

  return (
    <>
      <PageHeader
        title="Parties"
        action={
          canCreate ? (
            <Button ref={newTrigger} onClick={openCreate}>
              New party
            </Button>
          ) : undefined
        }
      />

      <PageBody>
        <ListToolbar>
          <SearchInput
            label="Search parties"
            placeholder="Search name or GSTIN"
            value={q}
            delay={150}
            fieldRef={field}
            onQueryChange={(next) => void setFilters({ q: next || undefined })}
            trailing={
              <FilterMenu anchor={field} active={chips.length > 0}>
                <FilterSubmenu icon={CircleDotIcon} label="Status">
                  {PARTY_STATUSES.map((each) => (
                    <DropdownMenuCheckboxItem
                      key={each}
                      checked={status === each}
                      onCheckedChange={(checked) =>
                        void setFilters({ status: checked ? each : undefined })
                      }
                    >
                      {STATUS_LABELS[each]}
                    </DropdownMenuCheckboxItem>
                  ))}
                </FilterSubmenu>
                <FilterSubmenu icon={TagsIcon} label="Role">
                  {PARTY_ROLES.map((role) => (
                    <DropdownMenuCheckboxItem
                      key={role}
                      checked={roles?.includes(role) ?? false}
                      onCheckedChange={() => void setFilters({ roles: toggleValue(roles, role) })}
                    >
                      {ROLE_LABELS[role]}
                    </DropdownMenuCheckboxItem>
                  ))}
                </FilterSubmenu>
                <FilterSubmenu icon={BadgeCheckIcon} label="GST">
                  {GST_FILTERS.map((each) => (
                    <DropdownMenuCheckboxItem
                      key={each}
                      checked={gst === each}
                      onCheckedChange={(checked) =>
                        void setFilters({ gst: checked ? each : undefined })
                      }
                    >
                      {GST_LABELS[each]}
                    </DropdownMenuCheckboxItem>
                  ))}
                </FilterSubmenu>
              </FilterMenu>
            }
          />
          <FilterChips filters={chips} field={field} onClear={clear} />
        </ListToolbar>

        <DataTable
          columns={PARTY_COLUMNS}
          data={rows}
          getRowId={(party) => party.id}
          meta={{ orgSlug }}
          rowLink={(party) => ({
            to: "/$orgSlug/parties",
            params: { orgSlug },
            search: (previous) => ({ ...previous, create: undefined, party: party.id }),
          })}
          renderCard={(party) => <PartyCard party={party} />}
          query={parties}
          errorTitle="Could not load parties"
          empty={empty}
          sorting={sorting}
          onSortingChange={onSortingChange}
          columnVisibility={columnVisibility}
          activeRowId={openPartyId}
          rowLimit={limit}
        />
        <LoadMore
          query={{
            isFetchNextPageError: false,
            hasNextPage: hasMore,
            isFetchingNextPage: false,
            fetchNextPage: showMore,
          }}
          shown={Math.min(limit, rows.length)}
        />
        {/* The quick look opens over the list, which stays mounted. */}
        {openParty ? (
          <PartyQuickLook
            orgSlug={orgSlug}
            party={openParty}
            onClose={closeQuickLook}
            onStep={(partyId) =>
              void navigate({
                replace: true,
                search: (previous) => ({ ...previous, party: partyId }),
              })
            }
          />
        ) : null}
      </PageBody>

      {canCreate ? (
        <PartySheet
          orgSlug={orgSlug}
          open={create === true}
          onClose={closeCreate}
          onSaved={(party) =>
            void navigate({
              search: (previous) => ({ ...previous, create: undefined, party: party.id }),
            })
          }
        />
      ) : null}
    </>
  );
}
