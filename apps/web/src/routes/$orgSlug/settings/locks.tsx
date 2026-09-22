import { LOCK_KINDS } from "@accly/db/schema/period-locks";
import { Button } from "@accly/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@accly/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { ReasonDialog } from "@/components/confirm-dialog";
import { LockExceptionSheet } from "@/components/lock-exception-sheet";
import { LockSheet } from "@/components/lock-sheet";
import { ListState, PageBody, PageHeader, Panel } from "@/components/page";
import { formatBusinessDate } from "@accly/api/lib/business-date";
import { invalidateLockState } from "@/lib/domain-invalidation";
import { LOCK_KIND_LABELS, lockStateOptions } from "@/lib/locks";
import { useCan } from "@/lib/membership";
import { orpc } from "@/lib/orpc";
import { errorMessage, hasErrorCode, isRefusal } from "@/lib/orpc-error";
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

  const closeSheet = () =>
    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, change: undefined, grant: undefined }),
    });

  const [revokeId, setRevokeId] = useState<string | null>(null);
  const locks = lockState.data;
  const exceptions = locks?.exceptions ?? [];

  const revoke = useMutation(
    orpc.lock.revokeException.mutationOptions({
      onSuccess: async () => {
        await invalidateLockState(queryClient, orgSlug);
        toast.success("Exception revoked");
        setRevokeId(null);
      },
      onError: async (error) => {
        // A lost response may have revoked it, and a CONFLICT means it is no longer
        // active. Either way this dialog's exception is stale.
        const uncertain = !isRefusal(error);

        if (uncertain || hasErrorCode(error, "CONFLICT")) {
          setRevokeId(null);
          await invalidateLockState(queryClient, orgSlug);
        }

        toast.error(
          uncertain
            ? "The result is uncertain. Check the exceptions before revoking it again."
            : errorMessage(error, "Could not revoke the exception"),
        );
      },
    }),
  );

  return (
    <>
      <PageHeader
        title="Locks"
        description="Close periods to posting. A cancellation is checked on the day it is made, not the document's date."
      />
      <SettingsTabs orgSlug={orgSlug} />
      <PageBody>
        <Panel label="Period locks">
          <ListState
            query={lockState}
            errorTitle="Could not load period locks"
            isEmpty={false}
            empty=""
          >
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead>Locked through</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Set by</TableHead>
                    {canSet ? <TableHead className="text-right">Action</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {LOCK_KINDS.map((kind) => {
                    const lock = locks?.[kind] ?? null;

                    return (
                      <TableRow key={kind}>
                        <TableCell className="font-medium">{LOCK_KIND_LABELS[kind]}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {lock?.lockedThrough
                            ? formatBusinessDate(lock.lockedThrough)
                            : "Not locked"}
                        </TableCell>
                        <TableCell className="max-w-64 whitespace-normal">
                          {lock?.reason ?? "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
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
                        </TableCell>
                        {canSet ? (
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="xs"
                              aria-label={`Change ${LOCK_KIND_LABELS[kind]} lock`}
                              onClick={() =>
                                void navigate({
                                  search: (previous) => ({
                                    ...previous,
                                    change: kind,
                                    grant: undefined,
                                  }),
                                })
                              }
                            >
                              Change
                            </Button>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="divide-y divide-border md:hidden">
              {LOCK_KINDS.map((kind) => {
                const lock = locks?.[kind] ?? null;

                return (
                  <div key={kind} className="grid gap-3 px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium">{LOCK_KIND_LABELS[kind]}</p>
                      {canSet ? (
                        <Button
                          variant="ghost"
                          size="xs"
                          className="shrink-0"
                          aria-label={`Change ${LOCK_KIND_LABELS[kind]} lock`}
                          onClick={() =>
                            void navigate({
                              search: (previous) => ({
                                ...previous,
                                change: kind,
                                grant: undefined,
                              }),
                            })
                          }
                        >
                          Change
                        </Button>
                      ) : null}
                    </div>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                      <dt className="text-muted-foreground">Locked through</dt>
                      <dd>
                        {lock?.lockedThrough
                          ? formatBusinessDate(lock.lockedThrough)
                          : "Not locked"}
                      </dd>
                      <dt className="text-muted-foreground">Reason</dt>
                      <dd className="break-words">{lock?.reason ?? "—"}</dd>
                      <dt className="text-muted-foreground">Set by</dt>
                      <dd>
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
          </ListState>
        </Panel>

        <Panel
          label="Exceptions at last refresh"
          action={
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="xs"
                disabled={lockState.isFetching}
                onClick={() => void lockState.refetch()}
              >
                {lockState.isFetching ? "Refreshing…" : "Refresh"}
              </Button>
              {canGrantException ? (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() =>
                    void navigate({
                      search: (previous) => ({
                        ...previous,
                        change: undefined,
                        grant: true,
                      }),
                    })
                  }
                >
                  Grant exception
                </Button>
              ) : null}
            </div>
          }
        >
          <ListState
            query={lockState}
            errorTitle="Could not load exceptions"
            isEmpty={exceptions.length === 0}
            empty="No active exceptions."
          >
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Granted by</TableHead>
                    {canGrantException ? (
                      <TableHead className="text-right">Action</TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exceptions.map((exception) => (
                    <TableRow key={exception.id}>
                      <TableCell>
                        <p className="font-medium">{exception.user.name}</p>
                        <p className="text-muted-foreground">{exception.user.email}</p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {formatDateTime(exception.expiresAt, timeZone)}
                      </TableCell>
                      <TableCell className="max-w-64 whitespace-normal">
                        {exception.reason}
                      </TableCell>
                      <TableCell>{exception.grantedBy.name}</TableCell>
                      {canGrantException ? (
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="xs"
                            aria-label={`Revoke exception for ${exception.user.name}`}
                            onClick={() => setRevokeId(exception.id)}
                          >
                            Revoke
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="divide-y divide-border md:hidden">
              {exceptions.map((exception) => (
                <div key={exception.id} className="grid gap-3 px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words font-medium">{exception.user.name}</p>
                      <p className="break-all text-muted-foreground">{exception.user.email}</p>
                    </div>
                    {canGrantException ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        className="shrink-0"
                        aria-label={`Revoke exception for ${exception.user.name}`}
                        onClick={() => setRevokeId(exception.id)}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                    <dt className="text-muted-foreground">Expires</dt>
                    <dd className="tabular-nums">
                      {formatDateTime(exception.expiresAt, timeZone)}
                    </dd>
                    <dt className="text-muted-foreground">Reason</dt>
                    <dd className="break-words">{exception.reason}</dd>
                    <dt className="text-muted-foreground">Granted by</dt>
                    <dd>{exception.grantedBy.name}</dd>
                  </dl>
                </div>
              ))}
            </div>
          </ListState>
        </Panel>
      </PageBody>

      {change && canSet && locks ? (
        <LockSheet orgSlug={orgSlug} kind={change} current={locks[change]} onClose={closeSheet} />
      ) : grant && canGrantException ? (
        <LockExceptionSheet orgSlug={orgSlug} onClose={closeSheet} />
      ) : null}
      <ReasonDialog
        open={revokeId !== null}
        pending={revoke.isPending}
        title="Revoke exception?"
        description="This exception will stop applying. Other active exceptions remain valid."
        placeholder="Why is this exception being revoked?"
        keepLabel="Keep exception"
        confirmLabel="Revoke exception"
        pendingLabel="Revoking…"
        onClose={() => setRevokeId(null)}
        onConfirm={(reason) => {
          if (revokeId) revoke.mutate({ orgSlug, exceptionId: revokeId, reason });
        }}
      />
    </>
  );
}
