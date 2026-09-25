import { searchQuery } from "@accly/api/lib/schemas";
import type { AppRouterClient } from "@accly/api/routers/index";
import { ORG_ROLES, ROLE_LABELS, parseRoles } from "@accly/auth/access";
import { Badge } from "@accly/ui/components/badge";
import { Button } from "@accly/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@accly/ui/components/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@accly/ui/components/form";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@accly/ui/components/dropdown-menu";
import { Input } from "@accly/ui/components/input";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ClientOnly, createFileRoute, useNavigate } from "@tanstack/react-router";
import { createColumnHelper } from "@tanstack/react-table";
import { CopyIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { useConfirm } from "@/components/confirm-dialog";
import { DataTable, DATA_TABLE_FEATURES } from "@/components/data-table/data-table";
import { RowActionsMenu } from "@/components/data-table/row-actions-menu";
import { TableEmpty } from "@/components/data-table/table-empty";
import { focusSearch } from "@/components/list-filter";
import { ListToolbar, LoadMore, PageBody, PageHeader, SearchInput } from "@/components/page";
import { useZodForm } from "@/hooks/use-zod-form";
import { invalidateMembership, invalidateRoster } from "@/lib/domain-invalidation";
import { orpc } from "@/lib/orpc";
import { errorMessage } from "@/lib/orpc-error";
import { formatDate, useOrgDateTime } from "@/lib/org-datetime";
import { useCan } from "@/lib/membership";

import { SettingsTabs } from "./route";

// Members page by the server keyset, 25 at a time (lib/schemas `pageLimit`).
const memberListOptions = (orgSlug: string, q: string | undefined) =>
  orpc.member.list.infiniteOptions({
    input: (cursor: string | undefined) => ({ orgSlug, q, cursor }),
    initialPageParam: undefined,
    getNextPageParam: (last) => (last.hasMore ? last.members.at(-1)?.id : undefined),
  });

export const Route = createFileRoute("/$orgSlug/settings/members")({
  head: () => ({ meta: [{ title: "Members · Accly Books" }] }),
  // The search lives in the URL, so a reload keeps it.
  validateSearch: z.object({ q: searchQuery.catch(undefined) }),
  loaderDeps: ({ search: { q } }) => ({ q }),
  loader: async ({ context: { queryClient }, deps: { q }, params: { orgSlug } }) => {
    await queryClient.infiniteQuery(memberListOptions(orgSlug, q)).catch(() => {});
  },
  component: MembersRoute,
});

/** A role is a comma-joined union, so it renders as one badge per role. */
function RoleBadge({ role }: { role: string }) {
  const roles = parseRoles(role);

  return (
    <span className="flex flex-wrap gap-1">
      {roles.map((one) => (
        <Badge key={one} variant={one === "owner" ? "default" : "muted"}>
          {ROLE_LABELS[one]}
        </Badge>
      ))}
    </span>
  );
}

const inviteSchema = z.object({
  email: z.string().trim().pipe(z.email("Enter a valid email address")),
  role: z.enum(ORG_ROLES, { error: "Select a role" }),
});

function InviteDialog({
  open,
  onOpenChange,
  orgSlug,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  orgSlug: string;
}) {
  const queryClient = useQueryClient();

  const form = useZodForm(inviteSchema, {
    defaultValues: { email: "" },
  });

  const [lastLink, setLastLink] = useState<string | null>(null);

  const invite = useMutation(
    orpc.member.invite.mutationOptions({
      onSuccess: (result) => {
        form.reset();
        setLastLink(result.url);
        toast.success(`Invitation created for ${result.email}`);

        // Returned, so the form stays pending until the list shows the invitation.
        return invalidateRoster(queryClient, orgSlug);
      },
      onError: (error) => toast.error(errorMessage(error, "Could not create the invitation")),
    }),
  );

  // `lastLink` is a single-use credential for one address — it must never survive
  // into the next invitation, so it clears the moment a new one is submitted.
  const submit = form.handleSubmit((values) => {
    setLastLink(null);
    invite.mutate({ orgSlug, ...values });
  });

  const change = (next: boolean) => {
    if (!next) {
      form.reset();
      setLastLink(null);
    }

    onOpenChange(next);
  };

  return (
    <ClientOnly fallback={null}>
      <Dialog open={open} onOpenChange={change}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite someone to this organization</DialogTitle>
            <DialogDescription>
              Nothing is emailed: share the link yourself. It lets the invited email create an
              account or sign in, then join. Roles can be changed later.
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form noValidate onSubmit={submit} className="flex min-w-0 flex-col gap-3">
              <RegisteredFormField
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email address</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="email"
                        placeholder="person@example.com"
                        disabled={invite.isPending}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <div role="group" aria-label="Role" className="flex gap-1">
                      {ORG_ROLES.map((option) => (
                        <Button
                          key={option}
                          type="button"
                          variant={field.value === option ? "secondary" : "ghost"}
                          size="sm"
                          aria-pressed={field.value === option}
                          onClick={() => field.onChange(option)}
                        >
                          {ROLE_LABELS[option]}
                        </Button>
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {lastLink && (
                <div className="flex min-w-0 items-center gap-2 bg-muted p-2">
                  <p className="min-w-0 flex-1 overflow-hidden font-mono text-xs text-ellipsis whitespace-nowrap text-muted-foreground">
                    {lastLink}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() =>
                      navigator.clipboard.writeText(lastLink).then(
                        () => toast.success("Invitation link copied"),
                        () => toast.error("Could not copy the link; select it and copy by hand"),
                      )
                    }
                  >
                    <CopyIcon />
                    Copy link
                  </Button>
                </div>
              )}

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => change(false)}>
                  Done
                </Button>
                <Button type="submit" disabled={invite.isPending}>
                  {invite.isPending ? "Creating…" : "Create invitation"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </ClientOnly>
  );
}

function InviteAction({ orgSlug, compact = false }: { orgSlug: string; compact?: boolean }) {
  const canInvite = useCan(orgSlug, { invitation: ["create"] });
  const [open, setOpen] = useState(false);

  if (!canInvite) return null;

  return (
    <>
      <Button size={compact ? "xs" : undefined} onClick={() => setOpen(true)}>
        {compact ? "Invite someone" : "Invite"}
      </Button>
      <InviteDialog open={open} onOpenChange={setOpen} orgSlug={orgSlug} />
    </>
  );
}

type RosterPage = Awaited<ReturnType<AppRouterClient["member"]["list"]>>;

/** A member or a pending invitation: the roster shows both in one table. */
type RosterRow =
  | ({ kind: "member" } & RosterPage["members"][number])
  | ({ kind: "invitation" } & RosterPage["invitations"][number]);

const col = createColumnHelper<typeof DATA_TABLE_FEATURES, RosterRow>();

const ROSTER_COLUMNS = [
  col.display({
    id: "person",
    header: "Person",
    cell: ({ row: { original: row } }) =>
      row.kind === "member" ? (
        <div className="min-w-0">
          <div className="truncate font-medium">{row.name}</div>
          <div className="truncate text-muted-foreground">{row.email}</div>
        </div>
      ) : (
        <span className="truncate text-muted-foreground">{row.email}</span>
      ),
  }),
  col.display({
    id: "role",
    header: "Role",
    meta: { className: "w-48" },
    cell: ({ row: { original: row } }) => <RosterRole row={row} />,
  }),
  col.display({
    id: "status",
    header: "Status",
    meta: { className: "w-56" },
    cell: ({ row: { original: row } }) => <RosterStatus row={row} />,
  }),
  col.display({
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    meta: { className: "w-10 px-1 text-center" },
    cell: ({ row, table }) => {
      const orgSlug = table.options.meta?.orgSlug;

      return orgSlug ? <RosterActions orgSlug={orgSlug} row={row.original} /> : null;
    },
  }),
];

function RosterRole({ row }: { row: RosterRow }) {
  return row.role ? <RoleBadge role={row.role} /> : <span>Unassigned</span>;
}

function RosterStatus({ row }: { row: RosterRow }) {
  const { timeZone } = useOrgDateTime();

  if (row.kind === "member") return <span className="text-muted-foreground">active</span>;

  return (
    <span className="flex items-center gap-2 whitespace-nowrap text-muted-foreground">
      <Badge variant="outline">invited</Badge>
      expires {formatDate(row.expiresAt, timeZone)}
    </span>
  );
}

function RosterCard({ orgSlug, row }: { orgSlug: string; row: RosterRow }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        {row.kind === "member" ? (
          <>
            <span className="truncate font-medium">{row.name}</span>
            <span className="truncate text-muted-foreground">{row.email}</span>
          </>
        ) : (
          <span className="truncate text-muted-foreground">{row.email}</span>
        )}
        <span className="flex flex-wrap items-center gap-2">
          <RosterRole row={row} />
          <RosterStatus row={row} />
        </span>
      </div>
      <RosterActions orgSlug={orgSlug} row={row} />
    </div>
  );
}

// The row owns its mutations and confirm dialog: both outlive the menu that starts them.
function RosterActions({ orgSlug, row }: { orgSlug: string; row: RosterRow }) {
  const queryClient = useQueryClient();
  const [confirm, confirmDialog] = useConfirm();
  // The roster is readable org-wide; only its actions need the grant.
  const canManage = useCan(orgSlug, { member: ["update", "delete"] });
  const canRevoke = useCan(orgSlug, { invitation: ["cancel"] });
  const onError = (error: Error) => toast.error(errorMessage(error, "Could not update the roster"));

  const updateRole = useMutation(
    orpc.member.updateRole.mutationOptions({
      onSuccess: async () => {
        await invalidateMembership(queryClient, orgSlug);
        toast.success("Role updated");
      },
      onError,
    }),
  );

  const removeMember = useMutation(
    orpc.member.remove.mutationOptions({
      onSuccess: async () => {
        await invalidateMembership(queryClient, orgSlug);
        toast.success("Member removed");
      },
      onError,
    }),
  );

  const revoke = useMutation(
    orpc.member.revokeInvitation.mutationOptions({
      onSuccess: async () => {
        await invalidateRoster(queryClient, orgSlug);
        toast.success("Invitation canceled");
      },
      onError,
    }),
  );

  if (row.kind === "member") {
    if (!canManage) return null;

    const name = row.name || row.email;

    return (
      <>
        <RowActionsMenu label={`Actions for ${name}`}>
          <DropdownMenuLabel>Change role</DropdownMenuLabel>
          {ORG_ROLES.map((option) => (
            <DropdownMenuItem
              key={option}
              disabled={parseRoles(row.role).includes(option) || updateRole.isPending}
              onClick={() => updateRole.mutate({ orgSlug, memberId: row.id, role: option })}
            >
              {ROLE_LABELS[option]}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={removeMember.isPending}
            onClick={() =>
              confirm({
                title: "Remove from organization?",
                description: `${name} loses access to this organization immediately. Their audit history is kept.`,
                confirmLabel: "Remove",
                run: () => removeMember.mutate({ orgSlug, memberId: row.id }),
              })
            }
          >
            Remove from organization
          </DropdownMenuItem>
        </RowActionsMenu>
        {confirmDialog}
      </>
    );
  }

  // Invitation rows arrive only for members with the invite grant. The link is the
  // only way to share an invitation, so Copy stays on a plain-http origin too.
  return (
    <>
      <RowActionsMenu label={`Actions for the invitation to ${row.email}`}>
        <DropdownMenuItem
          onClick={() =>
            navigator.clipboard.writeText(row.url).then(
              () => toast.success("Invitation link copied"),
              () => toast.error("Could not copy the link"),
            )
          }
        >
          <CopyIcon />
          Copy link
        </DropdownMenuItem>
        {canRevoke ? (
          <DropdownMenuItem
            variant="destructive"
            disabled={revoke.isPending}
            onClick={() =>
              confirm({
                title: "Cancel this invitation?",
                description: `The link for ${row.email} stops working. You can invite them again afterwards.`,
                confirmLabel: "Cancel invitation",
                run: () => revoke.mutate({ orgSlug, invitationId: row.id }),
              })
            }
          >
            Cancel invitation
          </DropdownMenuItem>
        ) : null}
      </RowActionsMenu>
      {confirmDialog}
    </>
  );
}

function MemberDirectory({ orgSlug, q }: { orgSlug: string; q: string | undefined }) {
  const navigate = useNavigate({ from: Route.fullPath });
  const field = useRef<HTMLDivElement>(null);
  const roster = useInfiniteQuery(memberListOptions(orgSlug, q));
  const pages = roster.data?.pages ?? [];

  // Invitations ride the first page only. They lead, so Load more appends members
  // below them and the pending invitations never move.
  const rows: RosterRow[] = [
    ...(pages[0]?.invitations ?? []).map((invite): RosterRow => ({
      kind: "invitation",
      ...invite,
    })),
    ...pages.flatMap((page) =>
      page.members.map((person): RosterRow => ({ kind: "member", ...person })),
    ),
  ];

  const setQuery = (next: string | undefined) =>
    navigate({ replace: true, search: (previous) => ({ ...previous, q: next }) });

  const clearSearch = () => {
    focusSearch(field, { empty: true });
    void setQuery(undefined);
  };

  return (
    <PageBody>
      <ListToolbar>
        <SearchInput
          label="Search members"
          placeholder="Name or email"
          value={q}
          fieldRef={field}
          onQueryChange={(next) => void setQuery(next || undefined)}
        />
      </ListToolbar>
      <DataTable
        columns={ROSTER_COLUMNS}
        data={rows}
        getRowId={(row) => `${row.kind}:${row.id}`}
        meta={{ orgSlug }}
        renderCard={(row) => <RosterCard orgSlug={orgSlug} row={row} />}
        query={roster}
        errorTitle="Could not load members"
        empty={
          <TableEmpty
            title="No members match"
            description="Try another name or email."
            action={
              <Button size="xs" variant="outline" onClick={clearSearch}>
                Clear search
              </Button>
            }
          />
        }
      />
      <LoadMore query={roster} shown={rows.length} />
    </PageBody>
  );
}

function MembersRoute() {
  const { orgSlug } = Route.useParams();
  const { q } = Route.useSearch();

  return (
    <>
      <PageHeader
        title="Members"
        description="Everyone with access to this organization"
        action={<InviteAction orgSlug={orgSlug} />}
      />
      <SettingsTabs orgSlug={orgSlug} />
      <MemberDirectory key={orgSlug} orgSlug={orgSlug} q={q} />
    </>
  );
}
