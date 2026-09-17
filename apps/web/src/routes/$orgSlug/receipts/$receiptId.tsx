// Copyright (c) Midday Labs AB, AGPL-3.0, from midday-ai/midday@51587319f26a0ffaa9dfccab1920373cb65689b7
// Adapted from apps/dashboard/src/components/invoice-details.tsx and sheets/invoice-details-sheet.tsx.
import { formatMoney } from "@accly/api/core/money";
import { Badge } from "@accly/ui/components/badge";
import { Button, buttonVariants } from "@accly/ui/components/button";
import { Separator } from "@accly/ui/components/separator";
import {
  Sheet,
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
import { ClientOnly, Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { ReasonDialog } from "@/components/confirm-dialog";
import { DetailRow } from "@/components/detail-row";
import { usePaletteActions } from "@/components/palette/use-palette-actions";
import { invalidateCashState } from "@/lib/domain-invalidation";
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

  // Cancelling reverses the receipt's active allocations in the same transaction, so
  // the dialog closes only once the record and its invoices have refetched.
  const cancel = useMutation(
    orpc.receipt.cancel.mutationOptions({
      onSuccess: async () => {
        await invalidateCashState(queryClient, orgSlug);
        setCancelOpen(false);
        toast.success("Receipt cancelled");
      },
      onError: (error) => {
        // Someone else cancelled it: refetch, so this Sheet shows the cancelled receipt.
        if (hasErrorCode(error, "CONFLICT")) {
          setCancelOpen(false);
          void invalidateCashState(queryClient, orgSlug);
        }

        toast.error(errorMessage(error, "Could not cancel the receipt"));
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
              <DetailRow label="Date">{formatDay(receipt.documentDate)}</DetailRow>
              <DetailRow label="Party">
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
              </DetailRow>
              <DetailRow label="Payment method">{receipt.printSnapshot?.paymentMethod}</DetailRow>
              <DetailRow label="Settlement">
                <span className="capitalize">{receipt.settlementKind}</span>
              </DetailRow>
              <DetailRow label="Reference" mono>
                {receipt.reference}
              </DetailRow>
            </dl>

            {receipt.allocations.length > 0 ? (
              <>
                <Separator />
                <section className="grid gap-2">
                  <h3 className="text-muted-foreground">Allocations</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">State</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {receipt.allocations.map((allocation) => (
                        <TableRow key={allocation.id}>
                          <TableCell>
                            <Link
                              to="/$orgSlug/invoices/$invoiceId"
                              params={{
                                orgSlug,
                                invoiceId: allocation.targetDocumentId,
                              }}
                              className="font-mono underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                            >
                              {allocation.targetNumber}
                            </Link>
                          </TableCell>
                          <TableCell>{formatDay(allocation.entryDate)}</TableCell>
                          <TableCell className="text-right">
                            {formatMoney(allocation.amountPaise)}
                          </TableCell>
                          <TableCell className="text-right">
                            {allocation.reversed ? (
                              <Badge variant="muted">Reversed</Badge>
                            ) : (
                              <Badge variant="outline">Active</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </section>
              </>
            ) : null}

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
        </SheetContent>
      </Sheet>
    </ClientOnly>
  );
}
