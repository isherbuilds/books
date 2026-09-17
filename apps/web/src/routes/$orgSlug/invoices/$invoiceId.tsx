import { formatMoney } from "@accly/api/core/money";
import { Badge } from "@accly/ui/components/badge";
import { Button } from "@accly/ui/components/button";
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
import { z } from "zod";

import { ApplyAdvanceSheet } from "@/components/apply-advance-sheet";
import { ReasonDialog } from "@/components/confirm-dialog";
import { DetailRow } from "@/components/detail-row";
import { InvoiceSheet } from "@/components/invoice-form";
import { InvoiceStatus, InvoiceTotals } from "@/components/invoice-summary";
import { invalidateInvoiceDrafts, invalidateSettlementState } from "@/lib/domain-invalidation";
import { invoiceDetailOptions, type InvoiceDetail } from "@/lib/invoices";
import { useCan } from "@/lib/membership";
import { formatDate, formatDay, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { errorMessage, hasErrorCode, loadRouteQuery } from "@/lib/orpc-error";
import { focusRowLink, stepRow } from "@/lib/row-focus";

export const Route = createFileRoute("/$orgSlug/invoices/$invoiceId")({
  // Design §10: editing a draft is `?edit=true` on its own Sheet.
  validateSearch: z.object({ edit: z.boolean().optional().catch(undefined) }),
  remountDeps: ({ params }) => ({ invoiceId: params.invoiceId }),
  loader: async ({ context: { queryClient }, params: { orgSlug, invoiceId } }) => {
    await loadRouteQuery(queryClient.query(invoiceDetailOptions(orgSlug, invoiceId)));
  },
  component: InvoiceSheetRoute,
});

function InvoiceSheetRoute() {
  const { orgSlug, invoiceId } = Route.useParams();
  const { edit } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const { timeZone, today } = useOrgDateTime();
  const invoice = useSuspenseQuery(invoiceDetailOptions(orgSlug, invoiceId)).data;
  const [cancelOpen, setCancelOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [reversing, setReversing] = useState<InvoiceDetail["allocations"][number] | null>(null);
  const isDraft = invoice.state === "draft";
  const cancelled = invoice.state === "cancelled";
  const canEdit = useCan(orgSlug, { invoice: ["create"] }) && isDraft;

  // The server refuses a cancel while an allocation is active, so reverse them first.
  const canCancel =
    useCan(orgSlug, { invoice: ["cancel"] }) &&
    invoice.state === "posted" &&
    invoice.allocations.every((allocation) => allocation.reversed);

  const canApply =
    useCan(orgSlug, { allocation: ["apply"] }) &&
    invoice.state === "posted" &&
    invoice.partyId !== null &&
    invoice.outstandingPaise > 0n;

  const canReverse = useCan(orgSlug, { allocation: ["reverse"] });
  const { partyName } = invoice;

  const close = () =>
    void navigate({
      to: "/$orgSlug/invoices",
      params: { orgSlug },
      search: ({ edit: _edit, ...previous }) => previous,
      replace: true,
    }).then(() => focusRowLink(invoiceId));

  const closeEdit = () =>
    void navigate({ search: ({ edit: _edit, ...previous }) => previous, replace: true });

  // Every CONFLICT here means the Sheet is stale: dismiss the overlay, refetch what
  // the failed write would have moved, and show the server's words.
  const refused =
    (fallback: string, dismiss: () => void, invalidate: () => Promise<void>) =>
    async (error: unknown) => {
      if (hasErrorCode(error, "CONFLICT")) {
        dismiss();
        await invalidate();
      }

      toast.error(errorMessage(error, fallback));
    };

  // Cancelling an invoice and reversing an allocation move settlement; discarding a
  // draft moves invoice reads alone.
  const invalidateSettlement = () => invalidateSettlementState(queryClient, orgSlug);
  const invalidateDrafts = () => invalidateInvoiceDrafts(queryClient, orgSlug);

  const cancel = useMutation(
    orpc.invoice.cancel.mutationOptions({
      onSuccess: async () => {
        await invalidateSettlement();
        setCancelOpen(false);
        toast.success("Invoice cancelled");
      },
      onError: refused(
        "Could not cancel the invoice",
        () => setCancelOpen(false),
        invalidateSettlement,
      ),
    }),
  );

  const reverse = useMutation(
    orpc.allocation.reverse.mutationOptions({
      onSuccess: async () => {
        await invalidateSettlement();
        setReversing(null);
        toast.success("Allocation reversed");
      },
      onError: refused(
        "Could not reverse the allocation",
        () => setReversing(null),
        invalidateSettlement,
      ),
    }),
  );

  const discard = useMutation(
    orpc.invoice.discardDraft.mutationOptions({
      onSuccess: async () => {
        await invalidateDrafts();
        toast.success("Draft discarded");
        close();
      },
      onError: refused("Could not discard the draft", close, invalidateDrafts),
    }),
  );

  if (edit && canEdit) {
    return (
      <InvoiceSheet
        orgSlug={orgSlug}
        today={today}
        draft={invoice}
        onClose={closeEdit}
        onPosted={closeEdit}
      />
    );
  }

  return (
    <ClientOnly fallback={null}>
      <Sheet open onOpenChange={(open) => !open && close()}>
        <SheetContent
          onKeyDown={(event) =>
            stepRow(
              event,
              invoiceId,
              (next) =>
                void navigate({
                  to: "/$orgSlug/invoices/$invoiceId",
                  params: { orgSlug, invoiceId: next },
                  search: ({ edit: _edit, ...previous }) => previous,
                  replace: true,
                }),
            )
          }
        >
          <SheetHeader>
            <div className="flex min-w-0 items-center gap-2">
              <SheetTitle className="min-w-0 truncate font-mono">
                {invoice.number ?? "Draft"}
              </SheetTitle>
              <InvoiceStatus invoice={invoice} />
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
                {formatMoney(invoice.totalPaise)}
              </p>
              {invoice.state === "posted" ? (
                <p className="text-muted-foreground">
                  Outstanding{" "}
                  <span className="tabular-nums text-foreground">
                    {formatMoney(invoice.outstandingPaise)}
                  </span>
                </p>
              ) : null}
            </div>

            <Separator />

            <dl className="grid gap-3">
              <DetailRow label="Class">
                {invoice.printClass === "taxInvoice" ? "Tax Invoice" : "Bill of Supply"}
              </DetailRow>
              <DetailRow label="Invoice date">{formatDay(invoice.documentDate)}</DetailRow>
              <DetailRow label="Due date">
                {invoice.dueDate ? formatDay(invoice.dueDate) : null}
              </DetailRow>
              <DetailRow label="Party">{partyName}</DetailRow>
              <DetailRow label="Place of supply" mono>
                {invoice.placeOfSupplyStateCode}
              </DetailRow>
              <DetailRow label="Reference" mono>
                {invoice.reference}
              </DetailRow>
              {invoice.cancelledAt ? (
                <DetailRow label="Cancelled">{formatDate(invoice.cancelledAt, timeZone)}</DetailRow>
              ) : null}
            </dl>

            {invoice.narration ? (
              <>
                <Separator />
                <section className="grid gap-1">
                  <h3 className="text-muted-foreground">Narration</h3>
                  <p className="whitespace-pre-wrap break-words">{invoice.narration}</p>
                </section>
              </>
            ) : null}

            {invoice.allocations.length > 0 ? (
              <>
                <Separator />
                <section className="grid gap-2">
                  <h3 className="text-muted-foreground">Allocations</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Receipt</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Status</TableHead>
                        {canReverse ? <TableHead className="w-20" /> : null}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoice.allocations.map((allocation) => (
                        <TableRow key={allocation.id}>
                          <TableCell className="font-mono">
                            <Link
                              to="/$orgSlug/receipts/$receiptId"
                              params={{ orgSlug, receiptId: allocation.sourceDocumentId }}
                              search={{}}
                              className="underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                            >
                              {allocation.sourceNumber}
                            </Link>
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {formatDay(allocation.entryDate)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(allocation.amountPaise)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={allocation.reversed ? "muted" : "secondary"}>
                              {allocation.reversed ? "Reversed" : "Active"}
                            </Badge>
                          </TableCell>
                          {canReverse ? (
                            <TableCell className="text-right">
                              {allocation.reversed ? null : (
                                <Button
                                  type="button"
                                  size="xs"
                                  variant="ghost"
                                  onClick={() => setReversing(allocation)}
                                >
                                  Reverse
                                </Button>
                              )}
                            </TableCell>
                          ) : null}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </section>
              </>
            ) : null}

            <Separator />

            <section className="grid gap-2">
              <h3 className="text-muted-foreground">Lines</h3>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead>HSN/SAC</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit price</TableHead>
                      <TableHead className="text-right">Taxable</TableHead>
                      <TableHead className="text-right">CGST</TableHead>
                      <TableHead className="text-right">SGST</TableHead>
                      <TableHead className="text-right">IGST</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoice.lines.map((line) => {
                      const lineTotal =
                        line.amountPaise + line.cgstPaise + line.sgstPaise + line.igstPaise;

                      return (
                        <TableRow key={line.id}>
                          <TableCell className="min-w-40 whitespace-normal">
                            {line.description}
                          </TableCell>
                          <TableCell className="font-mono">{line.hsnSac ?? "—"}</TableCell>
                          <TableCell className="text-right">
                            {line.quantity === null
                              ? "—"
                              : line.unit
                                ? `${line.quantity} ${line.unit}`
                                : line.quantity}
                          </TableCell>
                          <TableCell className="text-right">
                            {line.unitPricePaise === null ? "—" : formatMoney(line.unitPricePaise)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatMoney(line.amountPaise)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatMoney(line.cgstPaise)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatMoney(line.sgstPaise)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatMoney(line.igstPaise)}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatMoney(lineTotal)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="divide-y divide-border md:hidden">
                {invoice.lines.map((line) => {
                  const taxPaise = line.cgstPaise + line.sgstPaise + line.igstPaise;
                  const lineTotal = line.amountPaise + taxPaise;

                  return (
                    <div key={line.id} className="grid gap-2 py-3 first:pt-0 last:pb-0">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 break-words font-medium">{line.description}</p>
                        <p className="shrink-0 tabular-nums">{formatMoney(lineTotal)}</p>
                      </div>
                      <p className="text-muted-foreground">
                        {line.hsnSac ? <span className="font-mono">{line.hsnSac}</span> : null}
                        {line.quantity === null
                          ? null
                          : ` · ${line.quantity}${line.unit ? ` ${line.unit}` : ""} × `}
                        {line.unitPricePaise === null ? null : formatMoney(line.unitPricePaise)}
                      </p>
                      <div className="flex justify-between gap-3 text-muted-foreground">
                        <span>Taxable {formatMoney(line.amountPaise)}</span>
                        <span>Tax {formatMoney(taxPaise)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <Separator />

            <InvoiceTotals invoice={invoice} />
          </div>

          {canEdit || canApply || canCancel ? (
            <SheetFooter>
              {canEdit ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      void navigate({ search: (previous) => ({ ...previous, edit: true }) })
                    }
                  >
                    Edit draft
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={discard.isPending}
                    onClick={() =>
                      discard.mutate({
                        orgSlug,
                        draft: { id: invoice.id, version: invoice.version },
                      })
                    }
                  >
                    {discard.isPending ? "Discarding…" : "Discard draft"}
                  </Button>
                </>
              ) : null}
              {canApply ? (
                <Button type="button" variant="outline" onClick={() => setApplyOpen(true)}>
                  Apply advance
                </Button>
              ) : null}
              {canCancel ? (
                <Button type="button" variant="destructive" onClick={() => setCancelOpen(true)}>
                  Cancel invoice
                </Button>
              ) : null}
            </SheetFooter>
          ) : null}

          {/* Inside the Sheet, so Base UI treats each as nested: Esc closes it alone. */}
          <ReasonDialog
            open={cancelOpen}
            pending={cancel.isPending}
            title="Cancel invoice"
            description="This posts a reversal. The invoice remains in the register for audit history."
            placeholder="Why is this invoice being cancelled?"
            keepLabel="Keep invoice"
            confirmLabel="Cancel invoice"
            pendingLabel="Cancelling…"
            onClose={() => setCancelOpen(false)}
            onConfirm={(reason) => cancel.mutate({ orgSlug, invoiceId, reason })}
          />

          {/* Mounted per allocation, so its receipt number never blanks during a close. */}
          {reversing ? (
            <ReasonDialog
              open
              pending={reverse.isPending}
              title="Reverse allocation"
              description={`This removes the amount applied from receipt ${reversing.sourceNumber}.`}
              placeholder="Why is this allocation being reversed?"
              keepLabel="Keep allocation"
              confirmLabel="Reverse allocation"
              pendingLabel="Reversing…"
              onClose={() => setReversing(null)}
              onConfirm={(reason) =>
                reverse.mutate({ orgSlug, allocationId: reversing.id, reason })
              }
            />
          ) : null}

          {applyOpen && invoice.partyId ? (
            <ApplyAdvanceSheet
              orgSlug={orgSlug}
              invoiceId={invoice.id}
              partyId={invoice.partyId}
              onClose={() => setApplyOpen(false)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </ClientOnly>
  );
}
