import { formatBusinessDate } from "@accly/api/lib/business-date";
import { formatMoney, isPositiveMoney } from "@accly/api/core/money";
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
import { cn } from "@accly/ui/lib/utils";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { ClientOnly, Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { AllocationsSection } from "@/components/allocations-section";
import { ReasonDialog } from "@/components/confirm-dialog";
import { DetailRow } from "@/components/detail-row";
import { SETTLEMENT_KIND_LABELS, struck } from "@/components/document-columns";
import { invalidateCashState } from "@/lib/domain-invalidation";
import { useCan } from "@/lib/membership";
import { formatDate, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { handleWriteError, loadRouteQuery } from "@/lib/orpc-error";
import { focusRowLink, stepRow } from "@/lib/row-focus";

export const Route = createFileRoute("/$orgSlug/payments/$paymentId")({
  remountDeps: ({ params }) => ({ paymentId: params.paymentId }),
  loader: async ({ context: { queryClient }, params: { orgSlug, paymentId } }) => {
    await loadRouteQuery(
      queryClient.query(orpc.payment.get.queryOptions({ input: { orgSlug, paymentId } })),
    );
  },
  component: PaymentSheetRoute,
});

function PaymentSheetRoute() {
  const { orgSlug, paymentId } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const { timeZone } = useOrgDateTime();

  const payment = useSuspenseQuery(
    orpc.payment.get.queryOptions({ input: { orgSlug, paymentId } }),
  ).data;

  const cancelled = payment.state === "cancelled";
  const canCancel = useCan(orgSlug, { payment: ["cancel"] }) && !cancelled;
  const canReadParties = useCan(orgSlug, { party: ["read"] });
  const canReadBills = useCan(orgSlug, { bill: ["read"] });
  const [cancelOpen, setCancelOpen] = useState(false);
  const partyName = payment.printSnapshot?.party?.name;
  const refund = payment.exposureSide === "receivable";

  const close = () =>
    void navigate({
      to: "/$orgSlug/payments",
      params: { orgSlug },
      search: (previous) => previous,
      replace: true,
    }).then(() => focusRowLink(paymentId));

  const cancel = useMutation(
    orpc.payment.cancel.mutationOptions({
      onSuccess: async () => {
        await invalidateCashState(queryClient, orgSlug);
        setCancelOpen(false);
        toast.success("Payment cancelled");
      },
      onError: (error) =>
        handleWriteError(error, {
          settle: () => {
            setCancelOpen(false);

            return invalidateCashState(queryClient, orgSlug);
          },
          fallback: "Could not cancel the payment",
          uncertain: "The result is uncertain. Check the payment before cancelling it again.",
        }),
    }),
  );

  return (
    <ClientOnly fallback={null}>
      <Sheet open onOpenChange={(open) => !open && close()}>
        <SheetContent
          onKeyDown={(event) =>
            stepRow(
              event,
              paymentId,
              (next) =>
                void navigate({
                  to: "/$orgSlug/payments/$paymentId",
                  params: { orgSlug, paymentId: next },
                  search: (previous) => previous,
                  replace: true,
                }),
            )
          }
        >
          <SheetHeader>
            <div className="flex min-w-0 items-center gap-2">
              <SheetTitle className="min-w-0 truncate font-mono">
                {payment.number ?? "Payment"}
              </SheetTitle>
              {cancelled ? <Badge variant="muted">Cancelled</Badge> : null}
            </div>
            <SheetDescription>{partyName ?? "No party"}</SheetDescription>
          </SheetHeader>
          <SheetBody>
            <div className="grid gap-1">
              <p className={cn("text-2xl font-medium tabular-nums", struck(payment.state))}>
                {formatMoney(payment.totalPaise)}
              </p>
              {payment.cancelledAt ? (
                <p className="text-muted-foreground">
                  Cancelled on {formatDate(payment.cancelledAt, timeZone)}
                </p>
              ) : null}
            </div>
            <Separator />
            <dl className="grid gap-3">
              <DetailRow label="Date">{formatBusinessDate(payment.documentDate)}</DetailRow>
              <DetailRow label="Party">
                {payment.partyId && canReadParties ? (
                  <Link
                    to="/$orgSlug/parties/$partyId"
                    params={{ orgSlug, partyId: payment.partyId }}
                    className="underline-offset-4 hover:underline"
                  >
                    {partyName ?? "Party"}
                  </Link>
                ) : (
                  partyName
                )}
              </DetailRow>
              <DetailRow label="Payment method">{payment.printSnapshot?.paymentMethod}</DetailRow>
              <DetailRow label="Settlement">
                {refund
                  ? "Refund credit notes"
                  : payment.settlementKind && SETTLEMENT_KIND_LABELS[payment.settlementKind]}
              </DetailRow>
              <DetailRow label="Reference" mono>
                {payment.reference}
              </DetailRow>
              {payment.unappliedPaise !== null ? (
                <DetailRow label="Unapplied">{formatMoney(payment.unappliedPaise)}</DetailRow>
              ) : null}
            </dl>
            {payment.allocations === null ? (
              <>
                <Separator />
                <p className="text-muted-foreground">
                  Allocation details require access to {refund ? "Credit Notes" : "Bills"}.
                </p>
              </>
            ) : (
              <AllocationsSection orgSlug={orgSlug} allocations={payment.allocations} />
            )}
            {payment.adjustments.length > 0 ? (
              <>
                <Separator />
                <section className="grid gap-2">
                  <h3 className="text-muted-foreground">Adjustments</h3>
                  <dl className="grid gap-2">
                    {payment.adjustments.map((adjustment) => (
                      <DetailRow
                        key={adjustment.id}
                        label={adjustment.adjustmentKind === "fee" ? "Fee" : "Write-off"}
                      >
                        {formatMoney(adjustment.amountPaise)}
                      </DetailRow>
                    ))}
                  </dl>
                </section>
              </>
            ) : null}
            {payment.tds ? (
              <>
                <Separator />
                <section className="grid gap-2">
                  <h3 className="text-muted-foreground">TDS deducted</h3>
                  <dl className="grid gap-2">
                    <DetailRow label="Section">
                      {payment.tds.code} · {payment.tds.description}
                    </DetailRow>
                    <DetailRow label="Rate">
                      {(payment.tds.rateBasisPoints / 100).toFixed(2)}%
                    </DetailRow>
                    <DetailRow label="Base">{formatMoney(payment.tds.basePaise)}</DetailRow>
                    <DetailRow label="TDS">{formatMoney(payment.tds.amountPaise)}</DetailRow>
                  </dl>
                </section>
              </>
            ) : null}
            {payment.narration ? (
              <>
                <Separator />
                <section className="grid gap-1">
                  <h3 className="text-muted-foreground">Narration</h3>
                  <p className="whitespace-pre-wrap break-words">{payment.narration}</p>
                </section>
              </>
            ) : null}
          </SheetBody>
          <SheetFooter>
            {!cancelled &&
            payment.unappliedPaise !== null &&
            isPositiveMoney(payment.unappliedPaise) &&
            canReadBills ? (
              <Link
                to="/$orgSlug/bills"
                params={{ orgSlug }}
                className="underline-offset-4 hover:underline"
              >
                View bills to apply advance
              </Link>
            ) : null}
            {canCancel ? (
              <Button type="button" variant="destructive" onClick={() => setCancelOpen(true)}>
                Cancel payment
              </Button>
            ) : null}
          </SheetFooter>
          <ReasonDialog
            open={cancelOpen}
            pending={cancel.isPending}
            title="Cancel payment"
            description="This posts a reversal. The payment remains in the register for audit history."
            placeholder="Why is this payment being cancelled?"
            keepLabel="Keep payment"
            confirmLabel="Cancel payment"
            pendingLabel="Cancelling…"
            onClose={() => setCancelOpen(false)}
            onConfirm={(reason) => cancel.mutate({ orgSlug, paymentId, reason })}
          />
        </SheetContent>
      </Sheet>
    </ClientOnly>
  );
}
