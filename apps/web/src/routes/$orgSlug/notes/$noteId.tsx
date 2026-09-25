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
import { ClientOnly, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { AllocationsSection } from "@/components/allocations-section";
import { ReasonDialog } from "@/components/confirm-dialog";
import { DetailRow } from "@/components/detail-row";
import { struck } from "@/components/document-columns";
import { NoteSourceLink } from "@/components/note-columns";
import { invalidateSettlementState } from "@/lib/domain-invalidation";
import { useCan } from "@/lib/membership";
import { NOTE_TYPE_LABELS, noteDetailOptions } from "@/lib/notes";
import { useOrgDateTime, formatDate } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { handleWriteError, loadRouteQuery } from "@/lib/orpc-error";
import { focusRowLink, stepRow } from "@/lib/row-focus";

export const Route = createFileRoute("/$orgSlug/notes/$noteId")({
  remountDeps: ({ params }) => ({ noteId: params.noteId }),
  loader: async ({ context: { queryClient }, params: { orgSlug, noteId } }) => {
    await loadRouteQuery(queryClient.query(noteDetailOptions(orgSlug, noteId)));
  },
  component: NoteSheetRoute,
});

function NoteSheetRoute() {
  const { orgSlug, noteId } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const { timeZone } = useOrgDateTime();
  const note = useSuspenseQuery(noteDetailOptions(orgSlug, noteId)).data;
  const [cancelOpen, setCancelOpen] = useState(false);

  // Cancelling a note reverses the allocations it sources, so none has to be reversed first.
  const canCancel = useCan(orgSlug, { note: ["cancel"] }) && note.state === "posted";

  const canRefund =
    useCan(orgSlug, { payment: ["post"] }) &&
    note.type === "creditNote" &&
    note.state === "posted" &&
    isPositiveMoney(note.unappliedPaise);

  const invalidate = () => invalidateSettlementState(queryClient, orgSlug);

  const close = () =>
    void navigate({
      to: "/$orgSlug/notes",
      params: { orgSlug },
      search: (previous) => previous,
      replace: true,
    }).then(() => focusRowLink(noteId));

  const cancel = useMutation(
    orpc.note.cancel.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        setCancelOpen(false);
        toast.success("Note cancelled");
      },
      onError: (error) =>
        handleWriteError(error, {
          settle: () => {
            setCancelOpen(false);

            return invalidate();
          },
          fallback: "Could not cancel the note",
          uncertain: "The result is uncertain. Check the note before trying again.",
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
              noteId,
              (next) =>
                void navigate({
                  to: "/$orgSlug/notes/$noteId",
                  params: { orgSlug, noteId: next },
                  search: (previous) => previous,
                  replace: true,
                }),
            )
          }
        >
          <SheetHeader>
            <div className="flex min-w-0 items-center gap-2">
              <SheetTitle className="min-w-0 truncate font-mono">{note.number}</SheetTitle>
              <Badge variant={note.state === "cancelled" ? "muted" : "outline"}>
                {note.state === "cancelled" ? "Cancelled" : "Posted"}
              </Badge>
            </div>
            <SheetDescription>
              {NOTE_TYPE_LABELS[note.type]} · {note.printSnapshot?.party?.name ?? "No party"}
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <div className="grid gap-1">
              <p className={cn("text-2xl font-medium tabular-nums", struck(note.state))}>
                {formatMoney(note.totalPaise)}
              </p>
              {note.state === "posted" ? (
                <p className="text-muted-foreground">
                  Unapplied{" "}
                  <span className="tabular-nums text-foreground">
                    {formatMoney(note.unappliedPaise)}
                  </span>
                </p>
              ) : null}
            </div>
            <Separator />
            <dl className="grid gap-3">
              <DetailRow label="Date">{formatBusinessDate(note.documentDate)}</DetailRow>
              <DetailRow label="Against">
                {note.against ? (
                  <NoteSourceLink orgSlug={orgSlug} noteType={note.type} source={note.against} />
                ) : null}
              </DetailRow>
              {note.cancelledAt ? (
                <DetailRow label="Cancelled">{formatDate(note.cancelledAt, timeZone)}</DetailRow>
              ) : null}
            </dl>
            <Separator />
            <section className="grid gap-1">
              <h3 className="text-muted-foreground">Reason</h3>
              <p className="whitespace-pre-wrap break-words">{note.narration}</p>
            </section>
            <AllocationsSection orgSlug={orgSlug} allocations={note.allocations} />
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
                      <TableHead className="text-right">CGST</TableHead>
                      <TableHead className="text-right">SGST</TableHead>
                      <TableHead className="text-right">IGST</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="tabular-nums">
                    {note.lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell className="min-w-40 whitespace-normal">
                          {line.description}
                        </TableCell>
                        <TableCell className="font-mono">{line.hsnSac ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          {formatMoney(line.amountPaise)}
                        </TableCell>
                        <TableCell className="text-right">{formatMoney(line.cgstPaise)}</TableCell>
                        <TableCell className="text-right">{formatMoney(line.sgstPaise)}</TableCell>
                        <TableCell className="text-right">{formatMoney(line.igstPaise)}</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatMoney(
                            line.amountPaise + line.cgstPaise + line.sgstPaise + line.igstPaise,
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="divide-y divide-border md:hidden">
                {note.lines.map((line) => (
                  <div key={line.id} className="grid gap-2 py-3 first:pt-0 last:pb-0">
                    <div className="flex justify-between gap-3">
                      <p className="min-w-0 break-words font-medium">{line.description}</p>
                      <span className="tabular-nums">
                        {formatMoney(
                          line.amountPaise + line.cgstPaise + line.sgstPaise + line.igstPaise,
                        )}
                      </span>
                    </div>
                    <p className="text-muted-foreground">{line.hsnSac ?? "No HSN/SAC"}</p>
                    <p className="tabular-nums text-muted-foreground">
                      Taxable {formatMoney(line.amountPaise)} · CGST {formatMoney(line.cgstPaise)} ·
                      SGST {formatMoney(line.sgstPaise)} · IGST {formatMoney(line.igstPaise)}
                    </p>
                  </div>
                ))}
              </div>
            </section>
            <Separator />
            <dl className="grid gap-2">
              <DetailRow label="Round-off">{formatMoney(note.roundOffPaise)}</DetailRow>
            </dl>
          </SheetBody>
          {canRefund || canCancel ? (
            <SheetFooter>
              {canRefund && note.partyId ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    void navigate({
                      to: "/$orgSlug/payments",
                      params: { orgSlug },
                      search: { create: true, partyId: note.partyId! },
                    })
                  }
                >
                  Refund
                </Button>
              ) : null}
              {canCancel ? (
                <Button type="button" variant="destructive" onClick={() => setCancelOpen(true)}>
                  Cancel note
                </Button>
              ) : null}
            </SheetFooter>
          ) : null}
          <ReasonDialog
            open={cancelOpen}
            pending={cancel.isPending}
            title="Cancel note"
            description="This posts a reversal. The note remains in the register for audit history."
            placeholder="Why is this note being cancelled?"
            keepLabel="Keep note"
            confirmLabel="Cancel note"
            pendingLabel="Cancelling…"
            onClose={() => setCancelOpen(false)}
            onConfirm={(reason) => cancel.mutate({ orgSlug, noteId, reason })}
          />
        </SheetContent>
      </Sheet>
    </ClientOnly>
  );
}
