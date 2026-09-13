// Copyright (c) Midday Labs AB, AGPL-3.0, from midday-ai/midday@51587319f26a0ffaa9dfccab1920373cb65689b7
// Adapted from apps/dashboard/src/components/invoice-details.tsx and sheets/invoice-details-sheet.tsx.
import { formatMoney } from "@accly/api/core/money";
import { Badge } from "@accly/ui/components/badge";
import { Button, buttonVariants } from "@accly/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@accly/ui/components/dialog";
import { Separator } from "@accly/ui/components/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@accly/ui/components/sheet";
import { Textarea } from "@accly/ui/components/textarea";
import { cn } from "@accly/ui/lib/utils";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { ClientOnly, Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { usePaletteActions } from "@/components/palette/use-palette-actions";
import { invalidateReceiptState } from "@/lib/domain-invalidation";
import { useCan } from "@/lib/membership";
import { formatDate, formatDay, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { errorMessage, hasErrorCode, loadRouteQuery } from "@/lib/orpc-error";
import type { PaletteItem } from "@/lib/palette";
import { focusRowLink, stepRow } from "@/lib/row-focus";

export const Route = createFileRoute("/$orgSlug/receipts/$receiptId")({
  remountDeps: ({ params }) => ({ receiptId: params.receiptId }),
  loader: async ({ context: { queryClient }, params: { orgSlug, receiptId } }) => {
    await loadRouteQuery(
      queryClient.query(orpc.receipt.get.queryOptions({ input: { orgSlug, receiptId } })),
    );
  },
  component: ReceiptSheetRoute,
});

function CancelReceiptDialog({
  open,
  pending,
  reason,
  onReasonChange,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  pending: boolean;
  reason: string;
  onReasonChange: (reason: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel receipt</DialogTitle>
          <DialogDescription>
            This posts a reversal. The receipt remains in the register for audit history.
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-1.5 text-xs">
          <span>Reason</span>
          <Textarea
            required
            autoFocus
            value={reason}
            maxLength={500}
            rows={4}
            disabled={pending}
            onChange={(event) => onReasonChange(event.target.value)}
            placeholder="Why is this receipt being cancelled?"
          />
        </label>
        <DialogFooter>
          <Button variant="ghost" disabled={pending} onClick={onCancel}>
            Keep receipt
          </Button>
          <Button
            variant="destructive"
            disabled={pending || reason.trim().length === 0}
            onClick={onConfirm}
          >
            {pending ? "Cancelling…" : "Cancel receipt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, children, mono }: { label: string; children?: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "min-w-0 text-right break-words",
          children ? mono && "font-mono" : "text-muted-foreground",
        )}
      >
        {children || "—"}
      </dd>
    </div>
  );
}

// The record opens over the list, which stays mounted in the layout route, so
// closing the Sheet returns to the same scroll position and filters.
function ReceiptSheetRoute() {
  const { orgSlug, receiptId } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const { timeZone } = useOrgDateTime();

  const receipt = useSuspenseQuery(
    orpc.receipt.get.queryOptions({ input: { orgSlug, receiptId } }),
  ).data;

  const cancelled = receipt.state === "cancelled";
  const canCancel = useCan(orgSlug, { receipt: ["cancel"] }) && !cancelled;
  const canReadParties = useCan(orgSlug, { party: ["read"] });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const pdfHref = `/api/${orgSlug}/receipts/${receipt.id}/pdf`;
  const partyName = receipt.printSnapshot?.party?.name;

  const close = () =>
    void navigate({
      to: "/$orgSlug/receipts",
      params: { orgSlug },
      search: (previous) => previous,
      replace: true,
    }).then(() => focusRowLink(receiptId));

  const paletteActions: PaletteItem[] = [
    {
      id: `receipt:${receipt.id}:print`,
      label: "Print receipt",
      group: "action",
      run: () => window.open(pdfHref, "_blank", "noopener,noreferrer"),
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

  // Write the returned row first, so the Sheet strikes the amount and drops Cancel at
  // once; a second click would only get ALREADY_CANCELLED.
  const cancel = useMutation(
    orpc.receipt.cancel.mutationOptions({
      onSuccess: (detail) => {
        queryClient.setQueryData(
          orpc.receipt.get.queryKey({ input: { orgSlug, receiptId } }),
          detail,
        );
        void invalidateReceiptState(queryClient, orgSlug, receiptId);
        setCancelOpen(false);
        setReason("");
        toast.success("Receipt cancelled");
      },
      onError: (error) => {
        // Someone else cancelled it: refetch, so this Sheet shows the cancelled receipt.
        if (hasErrorCode(error, "CONFLICT")) {
          setCancelOpen(false);
          setReason("");
          void invalidateReceiptState(queryClient, orgSlug, receiptId);
        }

        toast.error(errorMessage(error, "Could not cancel the receipt"));
      },
    }),
  );

  const closeCancel = () => {
    if (cancel.isPending) return;

    setCancelOpen(false);
    setReason("");
  };

  return (
    <ClientOnly fallback={null}>
      <Sheet open onOpenChange={(open) => !open && close()}>
        <SheetContent
          onKeyDown={(event) =>
            stepRow(
              event,
              receiptId,
              (next) =>
                void navigate({
                  to: "/$orgSlug/receipts/$receiptId",
                  params: { orgSlug, receiptId: next },
                  search: (previous) => previous,
                  replace: true,
                }),
            )
          }
        >
          <SheetHeader>
            <div className="flex min-w-0 items-center gap-2">
              <SheetTitle className="min-w-0 truncate font-mono">
                {receipt.number ?? "Receipt"}
              </SheetTitle>
              {cancelled ? <Badge variant="muted">Cancelled</Badge> : null}
            </div>
            <SheetDescription>{partyName ?? "No party"}</SheetDescription>
          </SheetHeader>

          <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4">
            <div className="grid gap-1">
              <p
                className={cn(
                  "text-2xl font-medium tabular-nums",
                  cancelled && "text-muted-foreground line-through",
                )}
              >
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
              <Row label="Date">{formatDay(receipt.documentDate)}</Row>
              <Row label="Party">
                {receipt.partyId && canReadParties ? (
                  <Link
                    to="/$orgSlug/parties/$partyId"
                    params={{ orgSlug, partyId: receipt.partyId }}
                    className="underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                  >
                    {partyName ?? "Party"}
                  </Link>
                ) : (
                  partyName
                )}
              </Row>
              <Row label="Payment method">
                {receipt.printSnapshot?.paymentMethod ?? receipt.paymentMethodName}
              </Row>
              <Row label="Settlement">
                <span className="capitalize">{receipt.settlementKind}</span>
              </Row>
              <Row label="Reference" mono>
                {receipt.reference}
              </Row>
            </dl>

            {receipt.narration ? (
              <>
                <Separator />
                <section className="grid gap-1">
                  <h3 className="text-muted-foreground">Narration</h3>
                  <p className="whitespace-pre-wrap break-words">{receipt.narration}</p>
                </section>
              </>
            ) : null}
          </div>

          <SheetFooter>
            <a
              href={pdfHref}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "outline" })}
            >
              Print
            </a>
            {canCancel ? (
              <Button type="button" variant="destructive" onClick={() => setCancelOpen(true)}>
                Cancel receipt
              </Button>
            ) : null}
          </SheetFooter>

          {/* Inside the Sheet, so Base UI treats it as nested: Esc closes it alone. */}
          <CancelReceiptDialog
            open={cancelOpen}
            pending={cancel.isPending}
            reason={reason}
            onReasonChange={setReason}
            onCancel={closeCancel}
            onConfirm={() => cancel.mutate({ orgSlug, receiptId, reason: reason.trim() })}
          />
        </SheetContent>
      </Sheet>
    </ClientOnly>
  );
}
