import { formatBusinessDate } from "@accly/api/lib/business-date";
import { formatMoney } from "@accly/api/core/money";
import { Badge } from "@accly/ui/components/badge";
import { Button } from "@accly/ui/components/button";
import { Separator } from "@accly/ui/components/separator";
import { cn } from "@accly/ui/lib/utils";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { struck } from "@/components/document-columns";
import { ReasonDialog } from "@/components/confirm-dialog";
import { DetailRow } from "@/components/detail-row";
import { PageBody, PageHeader } from "@/components/page";
import { usePaletteActions } from "@/components/palette/use-palette-actions";
import { PostedLines } from "@/components/posted-lines";
import { invalidateJournalState } from "@/lib/domain-invalidation";
import { useCan } from "@/lib/membership";
import { formatDate, useOrgDateTime } from "@/lib/org-datetime";
import { journalDetailOptions } from "@/lib/journals";
import { orpc } from "@/lib/orpc";
import { loadRouteQuery, handleWriteError } from "@/lib/orpc-error";
import type { PaletteItem } from "@/lib/palette";
import { requireOrgPermission } from "@/lib/route-permission";

export const Route = createFileRoute("/$orgSlug/journals_/$journalId")({
  remountDeps: ({ params }) => ({ journalId: params.journalId }),
  loader: async ({ context: { queryClient }, params: { orgSlug, journalId } }) => {
    await requireOrgPermission(queryClient, orgSlug, { journal: ["read"] });

    const journal = await loadRouteQuery(
      queryClient.query(journalDetailOptions(orgSlug, journalId)),
    );

    return { number: journal.number };
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.number ?? "Journal"} · Accly Books` }],
  }),
  component: JournalPage,
});

function JournalPage() {
  const { orgSlug, journalId } = Route.useParams();
  const queryClient = useQueryClient();
  const { timeZone } = useOrgDateTime();

  const journal = useSuspenseQuery(journalDetailOptions(orgSlug, journalId)).data;

  const cancelled = journal.state === "cancelled";
  const canCancel = useCan(orgSlug, { journal: ["cancel"] }) && !cancelled;
  const [cancelOpen, setCancelOpen] = useState(false);

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
      onError: (error) =>
        handleWriteError(error, {
          settle: () => {
            setCancelOpen(false);

            return invalidateJournalState(queryClient, orgSlug);
          },
          fallback: "Could not cancel the journal",
          uncertain: "The result is uncertain. Check the journal before cancelling it again.",
        }),
    }),
  );

  return (
    <>
      <PageHeader
        title="Journal"
        description={`${journal.number} · ${formatBusinessDate(journal.documentDate)}`}
        action={
          canCancel ? (
            <Button variant="destructive" onClick={() => setCancelOpen(true)}>
              Cancel
            </Button>
          ) : undefined
        }
      />

      <PageBody>
        <div className="flex items-center justify-between gap-2">
          <p className={cn("text-2xl font-medium tabular-nums", struck(journal.state))}>
            {formatMoney(journal.totalPaise)}
          </p>
          <Badge variant={cancelled ? "muted" : "outline"}>
            {cancelled ? "Cancelled" : "Posted"}
          </Badge>
        </div>

        <dl className="grid max-w-2xl gap-3">
          <DetailRow label="Reference" mono>
            {journal.reference}
          </DetailRow>
          <DetailRow label="Narration">
            {journal.narration ? (
              <span className="whitespace-pre-wrap break-words">{journal.narration}</span>
            ) : null}
          </DetailRow>
          {journal.cancelledAt ? (
            <DetailRow label="Cancelled">{formatDate(journal.cancelledAt, timeZone)}</DetailRow>
          ) : null}
        </dl>

        <Separator />

        <PostedLines lines={journal.lines} />
      </PageBody>

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
    </>
  );
}
