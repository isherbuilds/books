import { NON_NEGATIVE_MONEY_PATTERN, formatMoney } from "@accly/api/core/money";
import { Badge } from "@accly/ui/components/badge";
import { Button } from "@accly/ui/components/button";
import {
  Form,
  FormControl,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@accly/ui/components/form";
import { Input } from "@accly/ui/components/input";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { useZodForm } from "@/hooks/use-zod-form";
import { invalidateSettlementState } from "@/lib/domain-invalidation";
import { formatDay } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { applyOrpcFieldError, errorMessage, errorReason, isRefusal } from "@/lib/orpc-error";

const applyAdvanceSchema = z.object({
  amount: z
    .string()
    .regex(NON_NEGATIVE_MONEY_PATTERN, "Enter a valid amount")
    .refine((value) => Number(value) > 0, "Amount must be greater than zero"),
});

/** Mounted only while open, so every open starts with no receipt and an empty amount. */
export function ApplyAdvanceSheet({
  orgSlug,
  invoiceId,
  partyId,
  onClose,
}: {
  orgSlug: string;
  invoiceId: string;
  partyId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const form = useZodForm(applyAdvanceSchema, { defaultValues: { amount: "" } });
  const receipts = useQuery(orpc.receipt.unapplied.queryOptions({ input: { orgSlug, partyId } }));
  const selected = receipts.data?.rows.find((receipt) => receipt.id === receiptId);

  const apply = useMutation(
    orpc.allocation.apply.mutationOptions({
      onSuccess: async () => {
        await invalidateSettlementState(queryClient, orgSlug);
        toast.success("Advance applied");
        onClose();
      },
      onError: async (error) => {
        // Retrying could apply it twice; the receipt and the invoice show whether it went through.
        if (!isRefusal(error)) {
          onClose();
          await invalidateSettlementState(queryClient, orgSlug);
          toast.error(
            "The result is uncertain. Check the receipt and invoice before applying it again.",
          );

          return;
        }

        const reason = errorReason(error);

        // The receipt or the invoice moved on since the sheet opened.
        if (reason === "ALLOCATION_SOURCE_INVALID" || reason === "ALLOCATION_TARGET_INVALID") {
          await invalidateSettlementState(queryClient, orgSlug);
          toast.error(errorMessage(error, "Could not apply the advance"));
          onClose();

          return;
        }

        // The server states the amount that still fits; the rows behind the sheet show it too.
        await invalidateSettlementState(queryClient, orgSlug);
        applyOrpcFieldError(
          form,
          error,
          { ALLOCATION_EXCEEDS_SOURCE: "amount", ALLOCATION_EXCEEDS_OUTSTANDING: "amount" },
          "Could not apply the advance",
        );
      },
    }),
  );

  const close = () => {
    if (!apply.isPending) onClose();
  };

  const submit = form.handleSubmit(({ amount }) => {
    if (!selected) return;

    apply.mutate({ orgSlug, receiptId: selected.id, invoiceId, amount });
  });

  return (
    <Sheet open onOpenChange={(next) => !next && close()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Apply advance</SheetTitle>
          <SheetDescription>
            Select an unapplied receipt and enter the amount to settle.
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
            <SheetBody>
              {receipts.isPending ? (
                <p className="text-muted-foreground">Loading unapplied receipts…</p>
              ) : receipts.isError ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-destructive">Could not load unapplied receipts.</p>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => void receipts.refetch()}
                  >
                    Try again
                  </Button>
                </div>
              ) : receipts.data.rows.length === 0 ? (
                <p className="text-muted-foreground">No unapplied receipts for this party.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Receipt</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Unapplied</TableHead>
                      <TableHead className="w-20" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {receipts.data.rows.map((receipt) => {
                      const chosen = receipt.id === receiptId;

                      return (
                        <TableRow key={receipt.id}>
                          <TableCell className="font-mono">{receipt.number}</TableCell>
                          <TableCell className="tabular-nums">
                            {formatDay(receipt.documentDate)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(receipt.unappliedPaise)}
                          </TableCell>
                          <TableCell className="text-right">
                            {chosen ? (
                              <Badge variant="secondary">Selected</Badge>
                            ) : (
                              <Button
                                type="button"
                                size="xs"
                                variant="ghost"
                                onClick={() => {
                                  setReceiptId(receipt.id);
                                  form.clearErrors();
                                  form.setValue("amount", "");
                                }}
                              >
                                Select
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}

              {receipts.data?.hasMore ? (
                <p className="text-muted-foreground">
                  Showing the 200 oldest unapplied receipts. Newer ones appear once these are used.
                </p>
              ) : null}

              {selected ? (
                <RegisteredFormField
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Amount from {selected.number}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          required
                          autoFocus
                          inputMode="decimal"
                          autoComplete="off"
                          pattern={NON_NEGATIVE_MONEY_PATTERN.source}
                          placeholder="0.00"
                          className="tabular-nums"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}
            </SheetBody>

            <SheetFooter>
              <Button type="button" variant="ghost" disabled={apply.isPending} onClick={close}>
                Keep invoice
              </Button>
              <Button type="submit" disabled={!selected || apply.isPending}>
                {apply.isPending ? "Applying…" : "Apply advance"}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
