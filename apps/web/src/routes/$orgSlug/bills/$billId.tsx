import { formatBusinessDate } from "@accly/api/lib/business-date";
import { formatMoney, isPositiveMoney } from "@accly/api/core/money";
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
import { ClientOnly, Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { AllocationsSection } from "@/components/allocations-section";
import { ApplyCreditSheet } from "@/components/apply-credit-sheet";
import { BillTdsRows } from "@/components/bill-form";
import { ReasonDialog } from "@/components/confirm-dialog";
import { DetailRow } from "@/components/detail-row";
import { ClaimStatus, struck } from "@/components/document-columns";
import { DocumentTotals } from "@/components/invoice-summary";
import { billDetailOptions } from "@/lib/bills";
import { invalidateBillDrafts, invalidateSettlementState } from "@/lib/domain-invalidation";
import { useCan } from "@/lib/membership";
import { formatDate, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { handleWriteError, loadRouteQuery } from "@/lib/orpc-error";
import { focusRowLink, stepRow } from "@/lib/row-focus";

export const Route = createFileRoute("/$orgSlug/bills/$billId")({
  remountDeps: ({ params }) => ({ billId: params.billId }),
  loader: async ({ context: { queryClient }, params: { orgSlug, billId } }) => {
    await loadRouteQuery(queryClient.query(billDetailOptions(orgSlug, billId)));
  },
  component: BillSheetRoute,
});

function BillSheetRoute() {
  const { orgSlug, billId } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const { timeZone } = useOrgDateTime();
  const bill = useSuspenseQuery(billDetailOptions(orgSlug, billId)).data;
  const [cancelOpen, setCancelOpen] = useState(false);
  const [amendOpen, setAmendOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const canEdit = useCan(orgSlug, { bill: ["create"] }) && bill.state === "draft";

  // The server refuses cancelling or amending while any allocation targets this bill.
  const allocationsReversed = bill.allocations.every((allocation) => allocation.reversed);

  const canAmend =
    useCan(orgSlug, { bill: ["cancel", "create"] }) &&
    bill.state === "posted" &&
    allocationsReversed;

  const canCancel =
    useCan(orgSlug, { bill: ["cancel"] }) && bill.state === "posted" && allocationsReversed;

  const canApply =
    useCan(orgSlug, { allocation: ["apply"], party: ["read"], note: ["read"] }) &&
    bill.state === "posted" &&
    bill.partyId !== null &&
    isPositiveMoney(bill.outstandingPaise);

  const canPay =
    useCan(orgSlug, { payment: ["post"] }) &&
    bill.state === "posted" &&
    bill.partyId !== null &&
    isPositiveMoney(bill.outstandingPaise);

  const canNote = useCan(orgSlug, { note: ["post"] }) && bill.state === "posted";

  const close = () =>
    void navigate({
      to: "/$orgSlug/bills",
      params: { orgSlug },
      search: (previous) => previous,
      replace: true,
    }).then(() => focusRowLink(billId));

  const invalidateSettlement = () => invalidateSettlementState(queryClient, orgSlug);
  const invalidateDrafts = () => invalidateBillDrafts(queryClient, orgSlug);

  const refused =
    (fallback: string, dismiss: () => void, invalidate: () => Promise<void>) => (error: unknown) =>
      handleWriteError(error, {
        settle: () => {
          dismiss();

          return invalidate();
        },
        fallback,
        uncertain: "The result is uncertain. Check the bill before trying again.",
      });

  const cancel = useMutation(
    orpc.bill.cancel.mutationOptions({
      onSuccess: async () => {
        await invalidateSettlement();
        setCancelOpen(false);
        toast.success("Bill cancelled");
      },
      onError: refused(
        "Could not cancel the bill",
        () => setCancelOpen(false),
        invalidateSettlement,
      ),
    }),
  );

  const discard = useMutation(
    orpc.bill.discardDraft.mutationOptions({
      onSuccess: async () => {
        await invalidateDrafts();
        toast.success("Draft discarded");
        close();
      },
      onError: refused("Could not discard the draft", close, invalidateDrafts),
    }),
  );

  const amend = useMutation(
    orpc.bill.amend.mutationOptions({
      onSuccess: async (draft) => {
        await invalidateSettlement();
        setAmendOpen(false);
        toast.success("Bill cancelled and draft created");
        void navigate({
          to: "/$orgSlug/bills/$billId/edit",
          params: { orgSlug, billId: draft.id },
        });
      },
      onError: refused("Could not amend the bill", () => setAmendOpen(false), invalidateSettlement),
    }),
  );

  return (
    <ClientOnly fallback={null}>
      <Sheet open onOpenChange={(open) => !open && close()}>
        <SheetContent
          onKeyDown={(event) =>
            stepRow(
              event,
              billId,
              (next) =>
                void navigate({
                  to: "/$orgSlug/bills/$billId",
                  params: { orgSlug, billId: next },
                  search: (previous) => previous,
                  replace: true,
                }),
            )
          }
        >
          <SheetHeader>
            <div className="flex min-w-0 items-center gap-2">
              <SheetTitle className="min-w-0 truncate font-mono">
                {bill.number ?? "Draft"}
              </SheetTitle>
              <ClaimStatus claim={bill} />
            </div>
            <SheetDescription>{bill.partyName ?? "No supplier"}</SheetDescription>
          </SheetHeader>
          <SheetBody>
            <div className="grid gap-1">
              <p className={cn("text-2xl font-medium tabular-nums", struck(bill.state))}>
                {formatMoney(bill.totalPaise)}
              </p>
              {bill.state === "posted" ? (
                <p className="text-muted-foreground">
                  Outstanding{" "}
                  <span className="tabular-nums text-foreground">
                    {formatMoney(bill.outstandingPaise)}
                  </span>
                </p>
              ) : null}
            </div>
            <Separator />
            <dl className="grid gap-3">
              <DetailRow label="Supplier invoice" mono>
                {bill.reference}
              </DetailRow>
              <DetailRow label="Supplier invoice date">
                {formatBusinessDate(bill.documentDate)}
              </DetailRow>
              <DetailRow label="Due date">
                {bill.dueDate ? formatBusinessDate(bill.dueDate) : null}
              </DetailRow>
              <DetailRow label="Supplier">{bill.partyName}</DetailRow>
              <DetailRow label="Place of supply" mono>
                {bill.placeOfSupplyStateCode}
              </DetailRow>
              {bill.amendedFromId ? (
                <DetailRow label="Amended from">
                  <Link
                    to="/$orgSlug/bills/$billId"
                    params={{ orgSlug, billId: bill.amendedFromId }}
                    className="font-mono underline-offset-4 hover:underline"
                  >
                    View original
                  </Link>
                </DetailRow>
              ) : null}
              {bill.cancelledAt ? (
                <DetailRow label="Cancelled">{formatDate(bill.cancelledAt, timeZone)}</DetailRow>
              ) : null}
            </dl>
            {bill.narration ? (
              <>
                <Separator />
                <section className="grid gap-1">
                  <h3 className="text-muted-foreground">Narration</h3>
                  <p className="whitespace-pre-wrap break-words">{bill.narration}</p>
                </section>
              </>
            ) : null}
            <AllocationsSection orgSlug={orgSlug} allocations={bill.allocations} />
            <Separator />
            <section className="grid gap-2">
              <h3 className="text-muted-foreground">Lines</h3>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead>HSN/SAC</TableHead>
                      <TableHead className="text-right">Taxable</TableHead>
                      <TableHead className="text-right">GST</TableHead>
                      <TableHead>ITC</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="tabular-nums">
                    {bill.lines.map((line) => {
                      const tax = line.cgstPaise + line.sgstPaise + line.igstPaise;

                      return (
                        <TableRow key={line.id}>
                          <TableCell className="min-w-40 whitespace-normal">
                            {line.description}
                          </TableCell>
                          <TableCell className="font-mono">{line.hsnSac ?? "—"}</TableCell>
                          <TableCell className="text-right">
                            {formatMoney(line.amountPaise)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatMoney(tax)}
                            {line.taxCode ? (
                              <span className="block text-muted-foreground">{line.taxCode}</span>
                            ) : null}
                          </TableCell>
                          <TableCell>{line.itcEligible ? "Eligible" : "No"}</TableCell>
                          <TableCell className="text-right font-medium">
                            {formatMoney(line.amountPaise + tax)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="divide-y divide-border md:hidden">
                {bill.lines.map((line) => {
                  const tax = line.cgstPaise + line.sgstPaise + line.igstPaise;

                  return (
                    <div key={line.id} className="grid gap-2 py-3 first:pt-0 last:pb-0">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 break-words font-medium">{line.description}</p>
                        <p className="shrink-0 tabular-nums">
                          {formatMoney(line.amountPaise + tax)}
                        </p>
                      </div>
                      <p className="text-muted-foreground">
                        {line.hsnSac ?? "No HSN/SAC"} · ITC{" "}
                        {line.itcEligible ? "eligible" : "not eligible"}
                      </p>
                      <div className="flex justify-between gap-3 text-muted-foreground">
                        <span>Taxable {formatMoney(line.amountPaise)}</span>
                        <span>
                          GST {formatMoney(tax)}
                          {line.taxCode ? ` · ${line.taxCode}` : ""}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
            <Separator />
            <DocumentTotals document={bill}>
              <BillTdsRows bill={bill} />
            </DocumentTotals>
          </SheetBody>
          {canEdit || canApply || canCancel || canAmend || canPay || canNote ? (
            <SheetFooter>
              {canEdit ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      void navigate({
                        to: "/$orgSlug/bills/$billId/edit",
                        params: { orgSlug, billId },
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
                      discard.mutate({ orgSlug, draft: { id: bill.id, version: bill.version } })
                    }
                  >
                    {discard.isPending ? "Discarding…" : "Discard draft"}
                  </Button>
                </>
              ) : null}
              {canPay ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    void navigate({
                      to: "/$orgSlug/payments",
                      params: { orgSlug },
                      search: { create: true, partyId: bill.partyId! },
                    })
                  }
                >
                  Pay
                </Button>
              ) : null}
              {canApply ? (
                <Button type="button" variant="outline" onClick={() => setApplyOpen(true)}>
                  Apply credit
                </Button>
              ) : null}
              {canNote ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    void navigate({
                      to: "/$orgSlug/notes/new",
                      params: { orgSlug },
                      search: { type: "debitNote", against: billId },
                    })
                  }
                >
                  Debit note
                </Button>
              ) : null}
              {canAmend ? (
                <Button type="button" variant="outline" onClick={() => setAmendOpen(true)}>
                  Amend
                </Button>
              ) : null}
              {canCancel ? (
                <Button type="button" variant="destructive" onClick={() => setCancelOpen(true)}>
                  Cancel bill
                </Button>
              ) : null}
            </SheetFooter>
          ) : null}
          <ReasonDialog
            open={cancelOpen}
            pending={cancel.isPending}
            title="Cancel bill"
            description="This posts a reversal. The bill remains in the register for audit history."
            placeholder="Why is this bill being cancelled?"
            keepLabel="Keep bill"
            confirmLabel="Cancel bill"
            pendingLabel="Cancelling…"
            onClose={() => setCancelOpen(false)}
            onConfirm={(reason) => cancel.mutate({ orgSlug, billId, reason })}
          />
          <ReasonDialog
            open={amendOpen}
            pending={amend.isPending}
            title="Amend bill"
            description="Cancel this bill and create a new draft with its details. Reverse any allocations first."
            placeholder="Why is this bill being amended?"
            keepLabel="Keep bill"
            confirmLabel="Amend bill"
            pendingLabel="Amending…"
            onClose={() => setAmendOpen(false)}
            onConfirm={(reason) => amend.mutate({ orgSlug, billId, reason })}
          />
          {applyOpen && bill.partyId ? (
            <ApplyCreditSheet
              orgSlug={orgSlug}
              side="payable"
              target={{
                id: bill.id,
                partyId: bill.partyId,
                number: bill.number ?? "Draft",
                outstandingPaise: bill.outstandingPaise,
              }}
              onClose={() => setApplyOpen(false)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </ClientOnly>
  );
}
