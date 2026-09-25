import { formatBusinessDate } from "@accly/api/lib/business-date";
import { LOCK_KINDS, type LockKind } from "@accly/db/schema/period-locks";
import { Button } from "@accly/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";

import { useConfirm } from "@/components/confirm-dialog";
import { LockDialog } from "@/components/lock-dialog";
import { LockExceptionDialog } from "@/components/lock-exception-dialog";
import { ListSection, ListState, PageBody, PageHeader } from "@/components/page";
import { invalidateLockState } from "@/lib/domain-invalidation";
import { LOCK_KIND_LABELS, lockStateOptions } from "@/lib/locks";
import { useCan } from "@/lib/membership";
import { orpc } from "@/lib/orpc";
import { handleWriteError } from "@/lib/orpc-error";
import { formatDateTime, useOrgDateTime } from "@/lib/org-datetime";
import { requireOrgPermission } from "@/lib/route-permission";

import { SettingsTabs } from "./route";

export const Route = createFileRoute("/$orgSlug/settings/locks")({
  head: () => ({ meta: [{ title: "Locks · Accly Books" }] }),
  validateSearch: z.object({
    change: z.enum(LOCK_KINDS).optional().catch(undefined),
    grant: z.boolean().optional().catch(undefined),
  }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { lock: ["read"] });
    await queryClient.query(lockStateOptions(orgSlug)).catch(() => {});
  },
  component: LocksRoute,
});

function LocksRoute() {
  const { orgSlug } = Route.useParams();
  const { change, grant } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { timeZone } = useOrgDateTime();
  const queryClient = useQueryClient();
  const lockState = useQuery(lockStateOptions(orgSlug));
  const canSet = useCan(orgSlug, { lock: ["set"] });
  const canGrantException = useCan(orgSlug, { lock: ["grantException"] });
  const [confirm, confirmDialog] = useConfirm();
  const locks = lockState.data;
  const exceptions = locks?.exceptions ?? [];

  const revoke = useMutation(
    orpc.lock.revokeException.mutationOptions({
      onSuccess: async () => {
        await invalidateLockState(queryClient, orgSlug);
        toast.success("Exception revoked");
      },
      onError: (error) =>
        handleWriteError(error, {
          settle: () => invalidateLockState(queryClient, orgSlug),
          fallback: "Could not revoke the exception",
          uncertain: "The result is uncertain. Check the exceptions before revoking it again.",
        }),
    }),
  );

  const openChange = (kind: LockKind) =>
    void navigate({ search: (previous) => ({ ...previous, change: kind, grant: undefined }) });

  const closeDialog = () =>
    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, change: undefined, grant: undefined }),
    });

  return (
    <>
      <PageHeader
        title="Locks"
        description="Close periods to posting. Ordinary cancellations use the cancellation date; Opening Balance corrections use the original cutover date."
        action={
          canGrantException ? (
            <Button
              onClick={() =>
                void navigate({
                  search: (previous) => ({ ...previous, change: undefined, grant: true }),
                })
              }
            >
              Grant exception
            </Button>
          ) : null
        }
      />
      <SettingsTabs orgSlug={orgSlug} />
      <PageBody>
        <ListState query={lockState} errorTitle="Could not load locks" isEmpty={false} empty={null}>
          <ListSection label="Period locks">
            <div className="divide-y divide-border">
              {LOCK_KINDS.map((kind) => {
                const lock = locks?.[kind] ?? null;

                return (
                  <div key={kind} className="grid gap-2 px-3 py-2">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium">{LOCK_KIND_LABELS[kind]}</p>
                      {canSet ? (
                        <Button
                          variant="ghost"
                          size="xs"
                          aria-label={`Change ${LOCK_KIND_LABELS[kind]} lock`}
                          onClick={() => openChange(kind)}
                        >
                          Change lock
                        </Button>
                      ) : null}
                    </div>
                    <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                      <dt className="text-muted-foreground">Locked through</dt>
                      <dd className="min-w-0">
                        {lock?.lockedThrough
                          ? formatBusinessDate(lock.lockedThrough)
                          : "Not locked"}
                      </dd>
                      <dt className="text-muted-foreground">Reason</dt>
                      <dd className="min-w-0 break-words">{lock?.reason ?? "—"}</dd>
                      <dt className="text-muted-foreground">Set by</dt>
                      <dd className="min-w-0 break-words">
                        {lock ? (
                          <>
                            <p>{lock.setBy.name}</p>
                            <p className="text-muted-foreground">
                              {formatDateTime(lock.setAt, timeZone)}
                            </p>
                          </>
                        ) : (
                          "—"
                        )}
                      </dd>
                    </dl>
                  </div>
                );
              })}
            </div>
          </ListSection>

          <ListSection label="Active exceptions">
            {exceptions.length === 0 ? (
              <p className="px-3 py-2 text-muted-foreground">No active exceptions.</p>
            ) : (
              <div className="divide-y divide-border">
                {exceptions.map((exception) => (
                  <div key={exception.id} className="grid gap-2 px-3 py-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words font-medium">{exception.user.name}</p>
                        <p className="break-all text-muted-foreground">{exception.user.email}</p>
                      </div>
                      {canGrantException ? (
                        <Button
                          variant="ghost"
                          size="xs"
                          aria-label={`Revoke exception for ${exception.user.name}`}
                          disabled={
                            revoke.isPending && revoke.variables.exceptionId === exception.id
                          }
                          onClick={() =>
                            confirm({
                              title: "Revoke exception?",
                              description:
                                "This member will no longer be able to post on or before the books lock.",
                              confirmLabel: "Revoke exception",
                              run: () => revoke.mutate({ orgSlug, exceptionId: exception.id }),
                            })
                          }
                        >
                          Revoke
                        </Button>
                      ) : null}
                    </div>
                    <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                      <dt className="text-muted-foreground">Expires</dt>
                      <dd className="min-w-0 tabular-nums">
                        {formatDateTime(exception.expiresAt, timeZone)}
                      </dd>
                      <dt className="text-muted-foreground">Reason</dt>
                      <dd className="min-w-0 break-words">{exception.reason}</dd>
                      <dt className="text-muted-foreground">Granted by</dt>
                      <dd className="min-w-0 break-words">{exception.grantedBy.name}</dd>
                    </dl>
                  </div>
                ))}
              </div>
            )}
          </ListSection>
        </ListState>
      </PageBody>

      {change && canSet && locks ? (
        // A new Organization or lock kind starts a fresh form and CAS token.
        <LockDialog
          key={`${orgSlug}:${change}`}
          orgSlug={orgSlug}
          kind={change}
          current={locks[change]}
          onClose={closeDialog}
        />
      ) : grant && canGrantException ? (
        <LockExceptionDialog orgSlug={orgSlug} onClose={closeDialog} />
      ) : null}
      {confirmDialog}
    </>
  );
}
