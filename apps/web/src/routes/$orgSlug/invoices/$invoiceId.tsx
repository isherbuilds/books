import { formatBusinessDate } from "@accly/api/lib/business-date";
import { formatMoney, isPositiveMoney } from "@accly/api/core/money";
import { Button, buttonVariants } from "@accly/ui/components/button";
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
import { ClientOnly, Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { AllocationsSection } from "@/components/allocations-section";
import { ClaimStatus, struck } from "@/components/document-columns";
import { ApplyCreditSheet } from "@/components/apply-credit-sheet";
import { ReasonDialog } from "@/components/confirm-dialog";
import { DetailRow } from "@/components/detail-row";
import { DocumentTotals } from "@/components/invoice-summary";
import { ReceiptOverlay } from "@/components/receipt-overlay";
import { invalidateInvoiceDrafts, invalidateSettlementState } from "@/lib/domain-invalidation";
import { invoiceDetailOptions } from "@/lib/invoices";
import { useCan } from "@/lib/membership";
import { formatDate, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { handleWriteError, loadRouteQuery } from "@/lib/orpc-error";
import { focusRowLink, stepRow } from "@/lib/row-focus";

export const Route = createFileRoute("/$orgSlug/invoices/$invoiceId")({
  remountDeps: ({ params }) => ({ invoiceId: params.invoiceId }),
  loader: async ({ context: { queryClient }, params: { orgSlug, invoiceId } }) => {
    await loadRouteQuery(queryClient.query(invoiceDetailOptions(orgSlug, invoiceId)));
  },
  component: InvoiceSheetRoute,
});

function InvoiceSheetRoute() {
  const { orgSlug, invoiceId } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const { timeZone, today } = useOrgDateTime();
  const invoice = useSuspenseQuery(invoiceDetailOptions(orgSlug, invoiceId)).data;
  const [cancelOpen, setCancelOpen] = useState(false);
  const [amendOpen, setAmendOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const isDraft = invoice.state === "draft";
  const canEdit = useCan(orgSlug, { invoice: ["create"] }) && isDraft;

  // The server refuses cancelling or amending while any allocation targets this invoice.
  const allocationsReversed = invoice.allocations.every((allocation) => allocation.reversed);

  const canCancel =
    useCan(orgSlug, { invoice: ["cancel"] }) && invoice.state === "posted" && allocationsReversed;

  const canAmend =
    useCan(orgSlug, { invoice: ["cancel", "create"] }) &&
    invoice.state === "posted" &&
    allocationsReversed;

  const canPostNote = useCan(orgSlug, { note: ["post"] }) && invoice.state === "posted";

  const canApply =
    useCan(orgSlug, { allocation: ["apply"], party: ["read"], note: ["read"] }) &&
    invoice.state === "posted" &&
    invoice.partyId !== null &&
    isPositiveMoney(invoice.outstandingPaise);

  // Posting the receipt refetches this invoice, so its outstanding is current on return.
  const canRecordReceipt =
    useCan(orgSlug, { receipt: ["post"] }) &&
    invoice.state === "posted" &&
    invoice.partyId !== null &&
    isPositiveMoney(invoice.outstandingPaise);

  const { partyName } = invoice;

  const close = () =>
    void navigate({
      to: "/$orgSlug/invoices",
      params: { orgSlug },
      search: (previous) => previous,
      replace: true,
    }).then(() => focusRowLink(invoiceId));

  // A CONFLICT or a lost response leaves the Sheet stale: dismiss the overlay and
  // refetch what the failed write would have moved.
  const refused =
    (fallback: string, dismiss: () => void, invalidate: () => Promise<void>) => (error: unknown) =>
      handleWriteError(error, {
        settle: () => {
          dismiss();

          return invalidate();
        },
        fallback,
        uncertain: "The result is uncertain. Check the invoice before trying again.",
      });

  // Cancelling an invoice and reversing an allocation move settlement; discarding a
  // draft moves invoice reads alone.
  const invalidateSettlement = () => invalidateSettlementState(queryClient, orgSlug);
  const invalidateDrafts = () => invalidateInvoiceDrafts(queryClient, orgSlug);

  const amend = useMutation(
    orpc.invoice.amend.mutationOptions({
      onSuccess: async (draft) => {
        // Settlement state covers invoice reads, drafts included.
        await invalidateSettlement();
        setAmendOpen(false);
        toast.success("Invoice draft ready");
        void navigate({
          to: "/$orgSlug/invoices/$invoiceId/edit",
          params: { orgSlug, invoiceId: draft.id },
        });
      },
      onError: refused(
        "Could not amend the invoice",
        () => setAmendOpen(false),
        invalidateSettlement,
      ),
    }),
  );

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
                  search: (previous) => previous,
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
              <ClaimStatus claim={invoice} />
            </div>
            <SheetDescription>{partyName ?? "No party"}</SheetDescription>
          </SheetHeader>

          <SheetBody>
            <div className="grid gap-1">
              <p className={cn("text-2xl font-medium tabular-nums", struck(invoice.state))}>
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
              <DetailRow label="Invoice date">{formatBusinessDate(invoice.documentDate)}</DetailRow>
              <DetailRow label="Due date">
                {invoice.dueDate ? formatBusinessDate(invoice.dueDate) : null}
              </DetailRow>
              <DetailRow label="Party">{partyName}</DetailRow>
              <DetailRow label="Place of supply" mono>
                {invoice.placeOfSupplyStateCode}
              </DetailRow>
              <DetailRow label="Reference" mono>
                {invoice.reference}
              </DetailRow>
              {invoice.amendedFromId ? (
                <DetailRow label="Amended from">
                  <Link
                    to="/$orgSlug/invoices/$invoiceId"
                    params={{ orgSlug, invoiceId: invoice.amendedFromId }}
                    className="font-mono underline-offset-4 hover:underline"
                  >
                    View original
                  </Link>
                </DetailRow>
              ) : null}
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

            {invoice.notes.length > 0 ? (
              <>
                <Separator />
                <section className="grid gap-2">
                  <h3 className="text-muted-foreground">Credit notes</h3>
                  {invoice.notes.map((note) => (
                    <div key={note.id} className="flex justify-between gap-3">
                      <Link
                        to="/$orgSlug/notes/$noteId"
                        params={{ orgSlug, noteId: note.id }}
                        className="font-mono underline-offset-4 hover:underline"
                      >
                        {note.number}
                      </Link>
                      <span className="tabular-nums">{formatMoney(note.totalPaise)}</span>
                    </div>
                  ))}
                </section>
              </>
            ) : null}
            <AllocationsSection orgSlug={orgSlug} allocations={invoice.allocations} />

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
                  <TableBody className="tabular-nums">
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
              <div className="divide-y divide-border tabular-nums md:hidden">
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

            <DocumentTotals document={invoice} />
          </SheetBody>

          {canEdit ||
          canRecordReceipt ||
          canApply ||
          canCancel ||
          canAmend ||
          canPostNote ||
          invoice.state === "posted" ? (
            <SheetFooter>
              {canEdit ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      void navigate({
                        to: "/$orgSlug/invoices/$invoiceId/edit",
                        params: { orgSlug, invoiceId },
                      })
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
              {canRecordReceipt ? (
                <Button type="button" variant="outline" onClick={() => setReceiptOpen(true)}>
                  Record receipt
                </Button>
              ) : null}
              {canApply ? (
                <Button type="button" variant="outline" onClick={() => setApplyOpen(true)}>
                  Apply credit
                </Button>
              ) : null}
              {canPostNote ? (
                <Link
                  to="/$orgSlug/notes/new"
                  params={{ orgSlug }}
                  search={{ type: "creditNote", against: invoice.id }}
                  className={buttonVariants({ variant: "outline" })}
                >
                  Credit note
                </Link>
              ) : null}
              {invoice.state === "posted" ? (
                <>
                  <a
                    href={`/api/${orgSlug}/invoices/${invoice.id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({ variant: "outline" })}
                  >
                    PDF
                  </a>
                  <a
                    href={`/api/${orgSlug}/invoices/${invoice.id}/pdf?download=1`}
                    className={buttonVariants({ variant: "outline" })}
                  >
                    Download PDF
                  </a>
                </>
              ) : null}
              {canAmend ? (
                <Button type="button" variant="outline" onClick={() => setAmendOpen(true)}>
                  Amend
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
          <ReasonDialog
            open={amendOpen}
            pending={amend.isPending}
            title="Amend invoice"
            description="This cancels the invoice and opens a copy as a draft. Reverse allocations before amending."
            placeholder="Why is this invoice being amended?"
            keepLabel="Keep invoice"
            confirmLabel="Amend invoice"
            pendingLabel="Amending…"
            onClose={() => setAmendOpen(false)}
            onConfirm={(reason) => amend.mutate({ orgSlug, invoiceId, reason })}
          />

          {applyOpen && invoice.partyId ? (
            <ApplyCreditSheet
              orgSlug={orgSlug}
              side="receivable"
              target={{
                id: invoice.id,
                partyId: invoice.partyId,
                number: invoice.number ?? invoice.id,
                outstandingPaise: invoice.outstandingPaise,
              }}
              onClose={() => setApplyOpen(false)}
            />
          ) : null}

          {receiptOpen && invoice.partyId ? (
            <ReceiptOverlay
              orgSlug={orgSlug}
              today={today}
              invoice={{
                id: invoice.id,
                number: invoice.number ?? invoice.id,
                documentDate: invoice.documentDate,
                dueDate: invoice.dueDate,
                partyId: invoice.partyId,
                partyName: partyName ?? "",
                outstandingPaise: invoice.outstandingPaise,
              }}
              open
              onClose={() => setReceiptOpen(false)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </ClientOnly>
  );
}
