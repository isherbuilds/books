import { formatBusinessDay } from "@accly/api/lib/business-date";
import { NON_NEGATIVE_MONEY_PATTERN, formatMoney, parseMoney } from "@accly/api/core/money";
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

import { orpc } from "@/lib/orpc";
import { applyOrpcFieldError, errorMessage, errorReason, handleWriteError } from "@/lib/orpc-error";
import { positiveAmount } from "@/lib/form-schema";

const applyCreditSchema = z.object({
  amount: positiveAmount,
});

/** Mounted only while open, so every open starts with no credit and an empty amount. */
export function ApplyCreditSheet({
  orgSlug,
  side,
  target,
  onClose,
}: {
  orgSlug: string;
  side: "receivable" | "payable";
  target: { id: string; partyId: string; number: string; outstandingPaise: bigint };
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [sourceId, setSourceId] = useState<string | null>(null);
  const form = useZodForm(applyCreditSchema, { defaultValues: { amount: "" } });

  const credits = useQuery(
    orpc.party.openCredits.queryOptions({
      input: { orgSlug, partyId: target.partyId, side },
    }),
  );

  const selected = credits.data?.rows.find((credit) => credit.id === sourceId);

  const apply = useMutation(
    orpc.allocation.apply.mutationOptions({
      onSuccess: async () => {
        await invalidateSettlementState(queryClient, orgSlug);
        toast.success("Credit applied");
        onClose();
      },
      onError: (error) =>
        handleWriteError(error, {
          settle: () => {
            onClose();

            return invalidateSettlementState(queryClient, orgSlug);
          },
          fallback: "Could not apply the credit",
          uncertain: "The result is uncertain. Check the documents before applying it again.",
          refuse: async () => {
            const reason = errorReason(error);

            if (reason === "ALLOCATION_SOURCE_INVALID" || reason === "ALLOCATION_TARGET_INVALID") {
              onClose();
              await invalidateSettlementState(queryClient, orgSlug);
              toast.error(errorMessage(error, "Could not apply the credit"));

              return;
            }

            // The server states the amount that still fits; the rows behind the sheet show it too.
            await invalidateSettlementState(queryClient, orgSlug);
            applyOrpcFieldError(
              form,
              error,
              { ALLOCATION_EXCEEDS_SOURCE: "amount", ALLOCATION_EXCEEDS_OUTSTANDING: "amount" },
              "Could not apply the credit",
            );
          },
        }),
    }),
  );

  const close = () => {
    if (!apply.isPending) onClose();
  };

  const submit = form.handleSubmit(({ amount }) => {
    if (!selected) return;

    const paise = parseMoney(amount);

    if (paise > selected.unappliedPaise || paise > target.outstandingPaise) {
      const maximum =
        selected.unappliedPaise < target.outstandingPaise
          ? selected.unappliedPaise
          : target.outstandingPaise;

      form.setError("amount", { message: `Enter no more than ${formatMoney(maximum)}` });

      return;
    }

    apply.mutate({ orgSlug, sourceDocumentId: selected.id, targetDocumentId: target.id, amount });
  });

  return (
    <Sheet open onOpenChange={(next) => !next && close()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Apply credit</SheetTitle>
          <SheetDescription>Select an unapplied credit to settle {target.number}.</SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
            <SheetBody>
              {credits.isPending ? (
                <p className="text-muted-foreground">Loading unapplied credits…</p>
              ) : credits.isError ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-destructive">Could not load unapplied credits.</p>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => void credits.refetch()}
                  >
                    Try again
                  </Button>
                </div>
              ) : credits.data.rows.length === 0 ? (
                <p className="text-muted-foreground">No unapplied credits for this party.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Credit</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Unapplied</TableHead>
                      <TableHead className="w-20" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {credits.data.rows.map((credit) => {
                      const chosen = credit.id === sourceId;

                      return (
                        <TableRow key={credit.id}>
                          <TableCell>
                            <span className="text-muted-foreground">
                              {credit.type === "creditNote"
                                ? "Credit Note"
                                : credit.type === "debitNote"
                                  ? "Debit Note"
                                  : credit.type === "payment"
                                    ? "Payment"
                                    : "Receipt"}{" "}
                              ·{" "}
                            </span>
                            <span className="font-mono">{credit.number}</span>
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {formatBusinessDay(credit.documentDate)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(credit.unappliedPaise)}
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
                                  setSourceId(credit.id);
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

              {credits.data?.hasMore ? (
                <p className="text-muted-foreground">
                  Showing the 200 oldest unapplied credits. Newer ones appear once these are used.
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
                Keep {side === "receivable" ? "invoice" : "bill"}
              </Button>
              <Button type="submit" disabled={!selected || apply.isPending}>
                {apply.isPending ? "Applying…" : "Apply credit"}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
