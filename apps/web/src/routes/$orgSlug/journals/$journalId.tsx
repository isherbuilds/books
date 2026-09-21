import { formatMoney } from "@accly/api/core/money";
import { Badge } from "@accly/ui/components/badge";
import { Button } from "@accly/ui/components/button";
import { Separator } from "@accly/ui/components/separator";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@accly/ui/components/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@accly/ui/components/table";
import { cn } from "@accly/ui/lib/utils";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { ClientOnly, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { ReasonDialog } from "@/components/confirm-dialog";
import { DetailRow } from "@/components/detail-row";
import { usePaletteActions } from "@/components/palette/use-palette-actions";
import { invalidateJournalState } from "@/lib/domain-invalidation";
import { useCan } from "@/lib/membership";
import { formatDate, formatDay, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { errorMessage, hasErrorCode, isRefusal, loadRouteQuery } from "@/lib/orpc-error";
import type { PaletteItem } from "@/lib/palette";
import { focusRowLink, stepRow } from "@/lib/row-focus";

export const Route = createFileRoute("/$orgSlug/journals/$journalId")({
  remountDeps: ({ params }) => ({ journalId: params.journalId }),
  loader: async ({ context: { queryClient }, params: { orgSlug, journalId } }) => {
    await loadRouteQuery(
      queryClient.query(orpc.journal.get.queryOptions({ input: { orgSlug, journalId } })),
    );
  },
  component: JournalSheetRoute,
});

function JournalSheetRoute() {
  const { orgSlug, journalId } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const { timeZone } = useOrgDateTime();

  const journal = useSuspenseQuery(
    orpc.journal.get.queryOptions({ input: { orgSlug, journalId } }),
  ).data;

  const cancelled = journal.state === "cancelled";
  const canCancel = useCan(orgSlug, { journal: ["cancel"] }) && !cancelled;
  const [cancelOpen, setCancelOpen] = useState(false);

  const close = () =>
    void navigate({
      to: "/$orgSlug/journals",
      params: { orgSlug },
      search: (previous) => previous,
      replace: true,
    }).then(() => focusRowLink(journalId));

  const paletteActions: PaletteItem[] = canCancel
    ? [
        {
          id: `journal:${journal.id}:cancel`,
          label: "Cancel journal",
          group: "action",
          run: () => setCancelOpen(true),
        },
      ]
    : [];

  usePaletteActions(paletteActions);

  const cancel = useMutation(
    orpc.journal.cancel.mutationOptions({
      onSuccess: async () => {
        await invalidateJournalState(queryClient, orgSlug);
        setCancelOpen(false);
        toast.success("Journal cancelled");
      },
      onError: async (error) => {
        // A 5xx or dropped connection may have committed the reversal; a CONFLICT means
        // someone else already cancelled it. Either way this Sheet's copy is stale.
        const uncertain = !isRefusal(error);

        if (uncertain || hasErrorCode(error, "CONFLICT")) {
          setCancelOpen(false);
          await invalidateJournalState(queryClient, orgSlug);
        }

        toast.error(
          uncertain
            ? "The result is uncertain. Check the journal before cancelling it again."
            : errorMessage(error, "Could not cancel the journal"),
        );
      },
    }),
  );

  return (
    <ClientOnly fallback={null}>
      <Sheet open onOpenChange={(open) => !open && close()}>
        <SheetContent
          onKeyDown={(event) =>
            stepRow(
              event,
              journalId,
              (next) =>
                void navigate({
                  to: "/$orgSlug/journals/$journalId",
                  params: { orgSlug, journalId: next },
                  search: (previous) => previous,
                  replace: true,
                }),
            )
          }
        >
          <SheetHeader>
            <div className="flex min-w-0 items-center gap-2">
              <SheetTitle className="min-w-0 truncate font-mono">{journal.number}</SheetTitle>
              <Badge variant={cancelled ? "muted" : "outline"}>
                {cancelled ? "Cancelled" : "Posted"}
              </Badge>
            </div>
            <SheetDescription>Manual journal voucher</SheetDescription>
          </SheetHeader>

          <SheetBody>
            <div className="grid gap-1">
              <p
                className={cn(
                  "text-2xl font-medium tabular-nums",
                  cancelled && "text-muted-foreground line-through",
                )}
              >
                {formatMoney(journal.totalPaise)}
              </p>
              {journal.cancelledAt ? (
                <p className="text-muted-foreground">
                  Cancelled on {formatDate(journal.cancelledAt, timeZone)}
                </p>
              ) : null}
            </div>

            <Separator />

            <dl className="grid gap-3">
              <DetailRow label="Date">{formatDay(journal.documentDate)}</DetailRow>
              <DetailRow label="Reference" mono>
                {journal.reference}
              </DetailRow>
            </dl>

            <Separator />

            <section className="grid gap-1">
              <h3 className="text-muted-foreground">Narration</h3>
              <p className="whitespace-pre-wrap break-words">{journal.narration}</p>
            </section>

            <Separator />

            <section className="grid gap-2">
              <h3 className="text-muted-foreground">Lines</h3>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                      <TableHead>Party</TableHead>
                      <TableHead>Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {journal.lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell className="whitespace-normal">
                          <p>{line.accountName}</p>
                          <p className="font-mono text-[0.6875rem] text-muted-foreground">
                            {line.accountCode}
                          </p>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {line.side === "debit" ? formatMoney(line.amountPaise) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {line.side === "credit" ? formatMoney(line.amountPaise) : "—"}
                        </TableCell>
                        <TableCell className="whitespace-normal">{line.partyName ?? "—"}</TableCell>
                        <TableCell className="whitespace-normal">{line.description}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="divide-y divide-border md:hidden">
                {journal.lines.map((line) => (
                  <div key={line.id} className="grid gap-2 px-3 py-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words font-medium">{line.accountName}</p>
                        <p className="font-mono text-[0.6875rem] text-muted-foreground">
                          {line.accountCode}
                        </p>
                      </div>
                      <p className="shrink-0 tabular-nums">
                        <span className="text-muted-foreground">
                          {line.side === "debit" ? "Dr" : "Cr"}
                        </span>{" "}
                        {formatMoney(line.amountPaise)}
                      </p>
                    </div>
                    {line.partyName ? (
                      <p className="break-words text-muted-foreground">{line.partyName}</p>
                    ) : null}
                    {line.description ? (
                      <p className="break-words text-muted-foreground">{line.description}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          </SheetBody>

          {canCancel ? (
            <SheetFooter>
              <Button type="button" variant="destructive" onClick={() => setCancelOpen(true)}>
                Cancel journal
              </Button>
            </SheetFooter>
          ) : null}

          <ReasonDialog
            open={cancelOpen}
            pending={cancel.isPending}
            title="Cancel journal"
            description="This posts a reversal. The journal remains in the register for audit history."
            placeholder="Why is this journal being cancelled?"
            keepLabel="Keep journal"
            confirmLabel="Cancel journal"
            pendingLabel="Cancelling…"
            onClose={() => setCancelOpen(false)}
            onConfirm={(reason) => cancel.mutate({ orgSlug, journalId, reason })}
          />
        </SheetContent>
      </Sheet>
    </ClientOnly>
  );
}
