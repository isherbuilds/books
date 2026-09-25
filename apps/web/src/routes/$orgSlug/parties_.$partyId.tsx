// Copyright (c) Midday Labs AB, AGPL-3.0, from midday-ai/midday@51587319f26a0ffaa9dfccab1920373cb65689b7
// Adapted from apps/dashboard/src/components/customer-details.tsx (the record header).
import { authorize, type AppPermission } from "@accly/auth/access";
import { Button } from "@accly/ui/components/button";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef } from "react";
import { z } from "zod";

import { PageBody, PageHeader, PageTab, PageTabs } from "@/components/page";
import { usePaletteActions } from "@/components/palette/use-palette-actions";
import { PartySheet } from "@/components/party-form";
import { useMembership } from "@/lib/membership";
import { partyDetailOptions } from "@/lib/parties";
import { loadRouteQuery } from "@/lib/orpc-error";

const PARTY_TABS: readonly {
  to:
    | "/$orgSlug/parties/$partyId"
    | "/$orgSlug/parties/$partyId/transactions"
    | "/$orgSlug/parties/$partyId/ledger";
  label: string;
  permission: AppPermission;
}[] = [
  { to: "/$orgSlug/parties/$partyId", label: "Overview", permission: { party: ["read"] } },
  // The read lists only the document types the member may read.
  {
    to: "/$orgSlug/parties/$partyId/transactions",
    label: "Transactions",
    permission: { party: ["read"] },
  },
  { to: "/$orgSlug/parties/$partyId/ledger", label: "Ledger", permission: { report: ["read"] } },
];

// A full page, not nested under the parties list: a party's history outgrows a Sheet.
// The list keeps its quick look; this page owns editing, transactions and the ledger.
export const Route = createFileRoute("/$orgSlug/parties_/$partyId")({
  validateSearch: z.object({ edit: z.boolean().optional().catch(undefined) }),
  remountDeps: ({ params }) => ({ partyId: params.partyId }),
  loader: async ({ context: { queryClient }, params: { orgSlug, partyId } }) => {
    const party = await loadRouteQuery(queryClient.query(partyDetailOptions(orgSlug, partyId)));

    return { name: party.name };
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.name ?? "Party"} · Accly Books` }],
  }),
  component: PartyPage,
});

function PartyPage() {
  const { orgSlug, partyId } = Route.useParams();
  const { edit } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const roles = useMembership(orgSlug, (membership) => membership.roles);
  const canUpdate = authorize(roles, { party: ["update"] });

  const party = useSuspenseQuery(partyDetailOptions(orgSlug, partyId)).data;

  const editButton = useRef<HTMLButtonElement>(null);

  // Opening pushes, so Back closes the edit; closing replaces that entry.
  const openEdit = () =>
    void navigate({ to: ".", search: (previous) => ({ ...previous, edit: true }) });

  // No trigger opens the Sheet (it follows `?edit`), so focus goes back by hand.
  const closeEdit = () =>
    void navigate({
      to: ".",
      search: (previous) => ({ ...previous, edit: undefined }),
      replace: true,
    }).then(() => editButton.current?.focus());

  usePaletteActions(
    canUpdate
      ? [
          {
            id: `party:${party.id}:edit`,
            label: "Edit party",
            group: "action",
            run: openEdit,
          },
        ]
      : [],
  );

  return (
    <>
      <PageHeader
        title="Party"
        description={party.gstin ? `${party.name} · ${party.gstin}` : party.name}
        action={
          canUpdate ? (
            <Button ref={editButton} onClick={openEdit}>
              Edit
            </Button>
          ) : undefined
        }
      />
      <PageTabs label="Party sections">
        {PARTY_TABS.flatMap(({ to, label, permission }) =>
          authorize(roles, permission)
            ? [
                <PageTab
                  key={to}
                  to={to}
                  params={{ orgSlug, partyId }}
                  // Overview is the index route, so prefix matching would keep it lit on every tab.
                  activeOptions={{
                    exact: to === "/$orgSlug/parties/$partyId",
                    includeSearch: false,
                  }}
                >
                  {label}
                </PageTab>,
              ]
            : [],
        )}
      </PageTabs>

      <PageBody>
        <Outlet />
      </PageBody>

      {canUpdate ? (
        <PartySheet
          orgSlug={orgSlug}
          party={party}
          open={edit === true}
          onClose={closeEdit}
          onSaved={closeEdit}
        />
      ) : null}
    </>
  );
}
