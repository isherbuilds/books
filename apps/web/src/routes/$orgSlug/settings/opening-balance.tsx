import { formatBusinessDate } from "@accly/api/lib/business-date";
import { Button } from "@accly/ui/components/button";
import { Separator } from "@accly/ui/components/separator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { ReasonDialog } from "@/components/confirm-dialog";
import { DetailRow } from "@/components/detail-row";
import { OpeningBalanceForm } from "@/components/opening-balance-form";
import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { PostedLines } from "@/components/posted-lines";
import { invalidateOpeningBalanceState } from "@/lib/domain-invalidation";
import { useCan } from "@/lib/membership";
import { openingBalanceOptions } from "@/lib/opening-balance";
import { formatDate, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { handleWriteError } from "@/lib/orpc-error";
import { requireOrgPermission } from "@/lib/route-permission";

import { SettingsTabs } from "./route";

export const Route = createFileRoute("/$orgSlug/settings/opening-balance")({
  head: () => ({ meta: [{ title: "Opening balance · Accly Books" }] }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { openingBalance: ["read"] });
    await queryClient.query(openingBalanceOptions(orgSlug)).catch(() => {});
  },
  component: OpeningBalanceRoute,
});

function OpeningBalanceRoute() {
  const { orgSlug } = Route.useParams();
  const queryClient = useQueryClient();
  const { timeZone } = useOrgDateTime();
  const canPost = useCan(orgSlug, { openingBalance: ["post"] });
  const canCancel = useCan(orgSlug, { openingBalance: ["cancel"] });
  const openingBalance = useQuery(openingBalanceOptions(orgSlug));
  const [cancelOpen, setCancelOpen] = useState(false);

  const cancel = useMutation(
    orpc.openingBalance.cancel.mutationOptions({
      onSuccess: async () => {
        await invalidateOpeningBalanceState(queryClient, orgSlug);
        setCancelOpen(false);
        toast.success("Opening balance cancelled");
      },
      onError: (error) =>
        handleWriteError(error, {
          settle: () => {
            setCancelOpen(false);

            return invalidateOpeningBalanceState(queryClient, orgSlug);
          },
          fallback: "Could not cancel the opening balance",
          uncertain: "The result is uncertain. Reload the page before cancelling it again.",
        }),
    }),
  );

  const document = openingBalance.data;

  return (
    <>
      <PageHeader
        title="Opening balance"
        description="Opening ledger balances on the cutover date."
        action={
          document && canCancel ? (
            <Button variant="destructive" onClick={() => setCancelOpen(true)}>
              Cancel opening balance
            </Button>
          ) : undefined
        }
      />
      <SettingsTabs orgSlug={orgSlug} />
      {openingBalance.isError ? (
        <PageBody>
          <ErrorNote title="Could not load the opening balance" error={openingBalance.error} />
        </PageBody>
      ) : document ? (
        <PageBody>
          <div className="grid gap-4">
            <h2 className="font-mono text-sm font-medium tabular-nums">{document.number}</h2>

            <dl className="grid max-w-2xl gap-3">
              <DetailRow label="As at">{formatBusinessDate(document.documentDate)}</DetailRow>
              <DetailRow label="Posted on">{formatDate(document.postedAt, timeZone)}</DetailRow>
            </dl>

            <Separator />

            <PostedLines lines={document.lines} totalPaise={document.totalPaise} />
          </div>
        </PageBody>
      ) : openingBalance.isPending ? (
        <PageBody />
      ) : canPost ? (
        <OpeningBalanceForm orgSlug={orgSlug} />
      ) : (
        <PageBody>
          <p className="text-muted-foreground">No opening balance posted</p>
        </PageBody>
      )}

      {document ? (
        <ReasonDialog
          open={cancelOpen}
          pending={cancel.isPending}
          title="Cancel opening balance"
          description="This reverses the balance on its original cutover date, changing historical balances. The original remains in the audit history."
          placeholder="Why is this opening balance being cancelled?"
          keepLabel="Keep opening balance"
          confirmLabel="Cancel opening balance"
          pendingLabel="Cancelling…"
          onClose={() => setCancelOpen(false)}
          onConfirm={(reason) => cancel.mutate({ orgSlug, openingBalanceId: document.id, reason })}
        />
      ) : null}
    </>
  );
}
