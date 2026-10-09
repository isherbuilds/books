import { documentRole } from "@accly/api/core/document-roles";
// Copyright (c) Midday Labs AB, AGPL-3.0, from midday-ai/midday@51587319f26a0ffaa9dfccab1920373cb65689b7
// Adapted from apps/dashboard/src/components/invoice-details.tsx and sheets/invoice-details-sheet.tsx.
import { formatBusinessDate } from "@accly/api/lib/business-date";
import { formatMoney } from "@accly/api/core/money";
import { ADJUSTMENT_LABELS, documentLabel } from "@accly/api/lib/document-labels";
import { Badge } from "@accly/ui/components/badge";
import { Button, buttonVariants } from "@accly/ui/components/button";
import { Separator } from "@accly/ui/components/separator";
import { SheetBody, SheetFooter } from "@accly/ui/components/sheet";
import { cn } from "@accly/ui/lib/utils";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, linkOptions, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { SETTLEMENT_KIND_LABELS, struck } from "@/components/document-columns";
import { AllocationsSection } from "@/components/allocations-section";
import { ReasonDialog } from "@/components/confirm-dialog";
import { DetailRow } from "@/components/detail-row";
import { usePaletteActions } from "@/components/palette/use-palette-actions";
import { PartyNameLink } from "@/components/party-name-link";
import { RecordSheet } from "@/components/record-sheet";
import { invalidateCashState } from "@/lib/domain-invalidation";
import { useCan } from "@/lib/membership";
import { formatDate, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { handleWriteError, loadRouteQuery } from "@/lib/orpc-error";
import type { PaletteItem } from "@/lib/palette";
import { focusRowLink } from "@/lib/row-focus";
import { receiptDetailOptions } from "@/lib/receipts";

export const Route = createFileRoute("/$orgSlug/receipts/$receiptId")({
  remountDeps: ({ params }) => ({ receiptId: params.receiptId }),
  loader: async ({ context: { queryClient }, params: { orgSlug, receiptId } }) => {
    await loadRouteQuery(queryClient.query(receiptDetailOptions(orgSlug, receiptId)));
  },
  component: ReceiptSheetRoute,
});

// The record opens over the list, which stays mounted in the layout route, so
// closing the Sheet returns to the same scroll position and filters.
function ReceiptSheetRoute() {
  const { orgSlug, receiptId } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const { timeZone } = useOrgDateTime();

  const receipt = useSuspenseQuery(receiptDetailOptions(orgSlug, receiptId)).data;

  const cancelled = receipt.state === "cancelled";
  const canCancel = useCan(orgSlug, { receipt: ["cancel"] }) && !cancelled;
  const canReadParties = useCan(orgSlug, { party: ["read"] });
  const [cancelOpen, setCancelOpen] = useState(false);
  const router = useRouter();
  const partyName = receipt.printSnapshot?.party?.name;

  const pdf = linkOptions({
    to: "/api/$orgSlug/receipts/$receiptId/pdf",
    params: { orgSlug, receiptId: receipt.id },
  });

  const close = () =>
    void navigate({
      to: "/$orgSlug/receipts",
      params: { orgSlug },
      search: (previous) => previous,
      replace: true,
    }).then(() => focusRowLink(receiptId));

  const paletteActions: PaletteItem[] = [
    {
      id: `receipt:${receipt.id}:pdf`,
      label: "PDF",
      group: "action",
      run: () => window.open(router.buildLocation(pdf).href, "_blank", "noopener,noreferrer"),
    },
    ...(canCancel
      ? [
          {
            id: `receipt:${receipt.id}:cancel`,
            label: "Cancel receipt",
            group: "action" as const,
            run: () => setCancelOpen(true),
          },
        ]
      : []),
  ];

  usePaletteActions(paletteActions);

  // Cancelling reverses the receipt's active allocations in the same transaction, so
  // the dialog closes only once the record and its invoices have refetched.
  const cancel = useMutation(
    orpc.receipt.cancel.mutationOptions({
      onSuccess: async () => {
        await invalidateCashState(queryClient, orgSlug);
        setCancelOpen(false);
        toast.success("Receipt cancelled");
      },
      // Someone else cancelled it: refetch, so this Sheet shows the cancelled receipt.
      onError: (error) =>
        handleWriteError(error, {
          settle: () => {
            setCancelOpen(false);

            return invalidateCashState(queryClient, orgSlug);
          },
          fallback: "Could not cancel the receipt",
          uncertain: "The result is uncertain. Check the receipt before cancelling it again.",
        }),
    }),
  );

  return (
    <RecordSheet
      rowId={receiptId}
      title={receipt.number ?? "Receipt"}
      status={cancelled ? <Badge>Cancelled</Badge> : null}
      description={
        <PartyNameLink
          orgSlug={orgSlug}
          partyId={receipt.partyId}
          name={partyName}
          canRead={canReadParties}
        />
      }
      onClose={close}
      onStep={(next) =>
        void navigate({
          to: "/$orgSlug/receipts/$receiptId",
          params: { orgSlug, receiptId: next },
          search: (previous) => previous,
          replace: true,
        })
      }
    >
      <SheetBody>
        <div className="grid gap-1">
          <p className={cn("text-2xl font-medium tabular-nums", struck(receipt.state))}>
            {formatMoney(receipt.totalPaise)}
          </p>
          {receipt.cancelledAt ? (
            <p className="text-muted-foreground">
              Cancelled on {formatDate(receipt.cancelledAt, timeZone)}
            </p>
          ) : null}
        </div>

        <Separator />

        <dl className="grid gap-3">
          <DetailRow label="Date">{formatBusinessDate(receipt.documentDate)}</DetailRow>
          <DetailRow label="Payment method">{receipt.printSnapshot?.paymentMethod}</DetailRow>
          <DetailRow label="Settlement">
            {documentRole(receipt).refund
              ? documentLabel("receipt", "payable")
              : receipt.settlementKind && SETTLEMENT_KIND_LABELS[receipt.settlementKind]}
          </DetailRow>
          <DetailRow label="Reference" mono>
            {receipt.reference}
          </DetailRow>
          {receipt.unappliedPaise !== null ? (
            <DetailRow label="Unapplied">{formatMoney(receipt.unappliedPaise)}</DetailRow>
          ) : null}
        </dl>

        {receipt.adjustments.length > 0 ? (
          <>
            <Separator />
            <section className="grid gap-2">
              <h3 className="text-muted-foreground">Adjustments</h3>
              <dl className="grid gap-2">
                {receipt.adjustments.map(({ id, adjustmentKind, amountPaise }) =>
                  // Adjustment lines always carry a kind; the selected column is typed nullable.
                  adjustmentKind ? (
                    <DetailRow key={id} label={ADJUSTMENT_LABELS[adjustmentKind]}>
                      {formatMoney(amountPaise)}
                    </DetailRow>
                  ) : null,
                )}
              </dl>
            </section>
          </>
        ) : null}

        <AllocationsSection orgSlug={orgSlug} allocations={receipt.allocations} />

        {receipt.narration ? (
          <>
            <Separator />
            <section className="grid gap-1">
              <h3 className="text-muted-foreground">Narration</h3>
              <p className="whitespace-pre-wrap break-words">{receipt.narration}</p>
            </section>
          </>
        ) : null}
      </SheetBody>

      <SheetFooter>
        <Link
          {...pdf}
          reloadDocument
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: "outline" })}
        >
          PDF
        </Link>
        {canCancel ? (
          <Button type="button" variant="destructive" onClick={() => setCancelOpen(true)}>
            Cancel receipt
          </Button>
        ) : null}
      </SheetFooter>

      {/* Inside the Sheet, so Base UI treats it as nested: Esc closes it alone. */}
      <ReasonDialog
        open={cancelOpen}
        pending={cancel.isPending}
        title="Cancel receipt"
        description="This posts a reversal. The receipt remains in the register for audit history."
        placeholder="Why is this receipt being cancelled?"
        keepLabel="Keep receipt"
        confirmLabel="Cancel receipt"
        pendingLabel="Cancelling…"
        onClose={() => setCancelOpen(false)}
        onConfirm={(reason) => cancel.mutate({ orgSlug, receiptId, reason })}
      />
    </RecordSheet>
  );
}
