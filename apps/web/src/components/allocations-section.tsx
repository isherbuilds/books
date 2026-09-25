import { formatMoney } from "@accly/api/core/money";
import { formatBusinessDay } from "@accly/api/lib/business-date";
import type { AppRouterClient } from "@accly/api/routers/index";
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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { ReasonDialog } from "@/components/confirm-dialog";
import { invalidateSettlementState } from "@/lib/domain-invalidation";
import { useCan } from "@/lib/membership";
import { orpc } from "@/lib/orpc";
import { handleWriteError } from "@/lib/orpc-error";

type Allocation = Awaited<ReturnType<AppRouterClient["invoice"]["get"]>>["allocations"][number];

const LINK = "font-mono underline-offset-4 hover:underline";

/** The document on the other side of an allocation, opened in its own register. */
function DocumentLink({ orgSlug, allocation }: { orgSlug: string; allocation: Allocation }) {
  const id = allocation.otherDocumentId;
  const number = allocation.otherNumber;

  switch (allocation.otherType) {
    case "invoice":
      return (
        <Link
          to="/$orgSlug/invoices/$invoiceId"
          params={{ orgSlug, invoiceId: id }}
          className={LINK}
        >
          {number}
        </Link>
      );
    case "bill":
      return (
        <Link to="/$orgSlug/bills/$billId" params={{ orgSlug, billId: id }} className={LINK}>
          {number}
        </Link>
      );
    case "creditNote":
    case "debitNote":
      return (
        <Link to="/$orgSlug/notes/$noteId" params={{ orgSlug, noteId: id }} className={LINK}>
          {number}
        </Link>
      );
    case "receipt":
      return (
        <Link
          to="/$orgSlug/receipts/$receiptId"
          params={{ orgSlug, receiptId: id }}
          className={LINK}
        >
          {number}
        </Link>
      );
    case "payment":
      return (
        <Link
          to="/$orgSlug/payments/$paymentId"
          params={{ orgSlug, paymentId: id }}
          className={LINK}
        >
          {number}
        </Link>
      );
    default:
      return <span className="font-mono">{number}</span>;
  }
}

/** A document's allocations, each reversible while active. */
export function AllocationsSection({
  orgSlug,
  allocations,
}: {
  orgSlug: string;
  allocations: readonly Allocation[];
}) {
  const queryClient = useQueryClient();
  const canReverse = useCan(orgSlug, { allocation: ["reverse"] });
  const [reversing, setReversing] = useState<Allocation | null>(null);
  const invalidate = () => invalidateSettlementState(queryClient, orgSlug);

  const reverse = useMutation(
    orpc.allocation.reverse.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        setReversing(null);
        toast.success("Allocation reversed");
      },
      onError: (error) =>
        handleWriteError(error, {
          settle: () => {
            setReversing(null);

            return invalidate();
          },
          fallback: "Could not reverse the allocation",
          uncertain: "The result is uncertain. Check the allocation before reversing it again.",
        }),
    }),
  );

  if (allocations.length === 0) return null;

  return (
    <>
      <Separator />
      <section className="grid gap-2">
        <h3 className="text-muted-foreground">Allocations</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Document</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              {canReverse ? <TableHead className="w-20" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {allocations.map((allocation) => (
              <TableRow key={allocation.id}>
                <TableCell>
                  <DocumentLink orgSlug={orgSlug} allocation={allocation} />
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatBusinessDay(allocation.entryDate)}
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

      {/* Mounted per allocation, so its number never blanks during a close. */}
      {reversing ? (
        <ReasonDialog
          open
          pending={reverse.isPending}
          title="Reverse allocation"
          description={`This removes the ${formatMoney(reversing.amountPaise)} applied with ${reversing.otherNumber}. Both documents become open to settle again.`}
          placeholder="Why is this allocation being reversed?"
          keepLabel="Keep allocation"
          confirmLabel="Reverse allocation"
          pendingLabel="Reversing…"
          onClose={() => setReversing(null)}
          onConfirm={(reason) => reverse.mutate({ orgSlug, allocationId: reversing.id, reason })}
        />
      ) : null}
    </>
  );
}
