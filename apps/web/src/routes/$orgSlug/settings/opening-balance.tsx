import { formatMoney } from "@accly/api/core/money";
import { Badge } from "@accly/ui/components/badge";
import { Button } from "@accly/ui/components/button";
import { Separator } from "@accly/ui/components/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@accly/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { ReasonDialog } from "@/components/confirm-dialog";
import { DetailRow } from "@/components/detail-row";
import { OpeningBalanceForm } from "@/components/opening-balance-form";
import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { invalidateOpeningBalanceState } from "@/lib/domain-invalidation";
import { useCan } from "@/lib/membership";
import { openingBalanceOptions } from "@/lib/opening-balance";
import { formatBusinessDate } from "@accly/api/lib/business-date";
import { formatDate, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { errorMessage, hasErrorCode, isRefusal } from "@/lib/orpc-error";
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
  const { today, timeZone } = useOrgDateTime();
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
      onError: async (error) => {
        const uncertain = !isRefusal(error);

        if (uncertain || hasErrorCode(error, "CONFLICT")) {
          setCancelOpen(false);
          await invalidateOpeningBalanceState(queryClient, orgSlug);
        }

        toast.error(
          uncertain
            ? "The result is uncertain. Reload the page before cancelling it again."
            : errorMessage(error, "Could not cancel the opening balance"),
        );
      },
    }),
  );

  const document = openingBalance.data;

  return (
    <>
      <PageHeader
        title="Opening balance"
        description="Opening ledger balances on the cutover date. Debits must equal credits."
      />
      <SettingsTabs orgSlug={orgSlug} />
      <PageBody>
        {openingBalance.isError ? (
          <ErrorNote title="Could not load the opening balance" error={openingBalance.error} />
        ) : document ? (
          <div className="grid max-w-4xl gap-4">
            <div className="flex items-center gap-2">
              <h2 className="font-mono text-sm font-medium">{document.number}</h2>
              <Badge variant="outline">Posted</Badge>
            </div>

            <dl className="grid max-w-2xl gap-3">
              <DetailRow label="As at">{formatBusinessDate(document.documentDate)}</DetailRow>
              <DetailRow label="Total">
                <span className="tabular-nums">{formatMoney(document.totalPaise)}</span>
              </DetailRow>
              <DetailRow label="Posted on">{formatDate(document.postedAt, timeZone)}</DetailRow>
            </dl>

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
                      <TableHead>Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {document.lines.map((line) => (
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
                        <TableCell className="whitespace-normal">{line.description}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="divide-y divide-border md:hidden">
                {document.lines.map((line) => (
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
                    {line.description ? (
                      <p className="break-words text-muted-foreground">{line.description}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>

            {canCancel ? (
              <div>
                <Button type="button" variant="destructive" onClick={() => setCancelOpen(true)}>
                  Cancel opening balance
                </Button>
              </div>
            ) : null}
          </div>
        ) : openingBalance.isPending ? null : canPost ? (
          <OpeningBalanceForm
            orgSlug={orgSlug}
            today={today}
            onPosted={() => toast.success("Opening balance posted")}
          />
        ) : (
          <p className="text-muted-foreground">No opening balance has been posted.</p>
        )}
      </PageBody>

      {document ? (
        <ReasonDialog
          open={cancelOpen}
          pending={cancel.isPending}
          title="Cancel opening balance"
          description="This posts a reversal. The opening balance remains in the audit history."
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
