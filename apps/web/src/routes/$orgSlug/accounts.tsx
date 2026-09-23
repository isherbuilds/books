import { searchQuery } from "@accly/api/lib/schemas";
import { ACCOUNT_TYPES, type AccountType } from "@accly/db/schema/accounts";
import { Button } from "@accly/ui/components/button";
import { DropdownMenuCheckboxItem } from "@accly/ui/components/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ListTreeIcon } from "lucide-react";
import { useRef } from "react";
import { z } from "zod";

import { ACCOUNT_COLUMNS, ACCOUNT_TYPE_LABELS, AccountCard } from "@/components/account-columns";
import { AccountSheet } from "@/components/account-sheet";
import { DataTable } from "@/components/data-table/data-table";
import { TableEmpty } from "@/components/data-table/table-empty";
import {
  FilterChips,
  FilterMenu,
  FilterSubmenu,
  focusSearch,
  type ActiveFilter,
} from "@/components/list-filter";
import { ListToolbar, PageBody, PageHeader, SearchInput } from "@/components/page";
import { accountListOptions, type AccountListRow, type AccountRow } from "@/lib/accounts";
import { filterLinkItems } from "@/lib/link-rows";
import { useCan } from "@/lib/membership";
import { focusRowLink } from "@/lib/row-focus";
import { requireOrgPermission } from "@/lib/route-permission";

type AccountFilters = {
  q?: string;
  type?: AccountType;
};

export const Route = createFileRoute("/$orgSlug/accounts")({
  head: () => ({ meta: [{ title: "Chart of accounts · Accly Books" }] }),
  validateSearch: z.object({
    q: searchQuery.catch(undefined),
    type: z.enum(ACCOUNT_TYPES).optional().catch(undefined),
    create: z.boolean().optional().catch(undefined),
    edit: z.uuid().optional().catch(undefined),
  }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { account: ["read"] });
    await queryClient.query(accountListOptions(orgSlug)).catch(() => {});
  },
  component: AccountsRoute,
});

function AccountsRoute() {
  const { orgSlug } = Route.useParams();
  const { q, type, create, edit } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const field = useRef<HTMLDivElement>(null);
  const newTrigger = useRef<HTMLButtonElement>(null);
  const canCreate = useCan(orgSlug, { account: ["create"] });
  const canUpdate = useCan(orgSlug, { account: ["update"] });
  const accounts = useQuery({ ...accountListOptions(orgSlug), select: deriveRows });
  const allAccounts = accounts.data ?? [];
  const typed = type ? allAccounts.filter((account) => account.type === type) : allAccounts;

  const rows = filterLinkItems(
    typed,
    q ?? "",
    (account) => account.name,
    (account) => account.code,
  );

  const openAccount = edit ? allAccounts.find((account) => account.id === edit) : undefined;

  function setFilters(patch: AccountFilters) {
    return navigate({ replace: true, search: (previous) => ({ ...previous, ...patch }) });
  }

  function clearFilters() {
    focusSearch(field, { empty: true });
    void setFilters({ q: undefined, type: undefined });
  }

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

  const chips: ActiveFilter[] = type
    ? [
        {
          id: "type",
          name: "Type",
          label: ACCOUNT_TYPE_LABELS[type],
          remove: () => setFilters({ type: undefined }),
        },
      ]
    : [];

  const empty =
    q !== undefined || type !== undefined ? (
      <TableEmpty
        title="No accounts match"
        description="Try another search or clear the filters."
        action={
          <Button size="xs" variant="outline" onClick={clearFilters}>
            Clear filters
          </Button>
        }
      />
    ) : (
      <TableEmpty
        title="No accounts yet"
        description="Accounts in your chart appear here."
        action={
          canCreate ? (
            <Button size="xs" variant="outline" onClick={openCreate}>
              New account
            </Button>
          ) : undefined
        }
      />
    );

  return (
    <>
      <PageHeader
        title="Chart of accounts"
        action={
          canCreate ? (
            <Button ref={newTrigger} onClick={openCreate}>
              New account
            </Button>
          ) : undefined
        }
      />
      <PageBody>
        <ListToolbar>
          <SearchInput
            label="Search accounts"
            placeholder="Search name or code"
            value={q}
            delay={150}
            fieldRef={field}
            onQueryChange={(next) => void setFilters({ q: next || undefined })}
            trailing={
              <FilterMenu anchor={field} active={type !== undefined}>
                <FilterSubmenu icon={ListTreeIcon} label="Type">
                  {ACCOUNT_TYPES.map((accountType) => (
                    <DropdownMenuCheckboxItem
                      key={accountType}
                      checked={type === accountType}
                      onCheckedChange={(checked) =>
                        void setFilters({ type: checked ? accountType : undefined })
                      }
                    >
                      {ACCOUNT_TYPE_LABELS[accountType]}
                    </DropdownMenuCheckboxItem>
                  ))}
                </FilterSubmenu>
              </FilterMenu>
            }
          />
          <FilterChips filters={chips} field={field} onClear={clearFilters} />
        </ListToolbar>

        <DataTable
          columns={ACCOUNT_COLUMNS}
          data={rows}
          getRowId={(account) => account.id}
          meta={{ orgSlug }}
          rowLink={
            canUpdate
              ? (account) => ({
                  to: "/$orgSlug/accounts",
                  params: { orgSlug },
                  search: (previous) => ({
                    ...previous,
                    create: undefined,
                    edit: account.id,
                  }),
                })
              : undefined
          }
          renderCard={(account) => <AccountCard account={account} />}
          query={accounts}
          errorTitle="Could not load accounts"
          empty={empty}
          activeRowId={edit}
        />
      </PageBody>

      {(create && canCreate) || (openAccount && canUpdate) ? (
        <AccountSheet
          key={openAccount?.id ?? "new"}
          orgSlug={orgSlug}
          account={openAccount}
          accounts={allAccounts}
          onClose={closeSheet}
        />
      ) : null}
    </>
  );
}

function deriveRows(accounts: AccountListRow[]): AccountRow[] {
  const byId = new Map<string, AccountListRow>();
  const groupIds = new Set<string>();

  for (const account of accounts) {
    byId.set(account.id, account);

    if (account.parentId) groupIds.add(account.parentId);
  }

  return accounts.map((account) => ({
    ...account,
    isGroup: groupIds.has(account.id),
    parentName: account.parentId ? (byId.get(account.parentId)?.name ?? null) : null,
  }));
}
