// Payment lines adapted from HMS `opd-settlement-fields.tsx` (`nextPaymentLine`,
// `PaymentBalance`): split across methods, Fill the rest, and refuse more than owed.

import {
  ZERO_MONEY,
  enteredPaise,
  formatDecimal,
  formatMoney,
  sumPaise,
} from "@accly/api/core/money";
import { Button } from "@accly/ui/components/button";
import {
  FormControl,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@accly/ui/components/form";
import { Input } from "@accly/ui/components/input";
import { cn } from "@accly/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Trash2Icon } from "lucide-react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { z } from "zod";

import { AmountInput } from "@/components/amount-input";
import { FieldArrayError } from "@/components/document-form";
import { PaymentMethodField } from "@/components/payment-method-field";
import { positiveAmount } from "@/lib/form-schema";
import { activePaymentMethodsOptions } from "@/lib/receipts";

export const MAX_PAYMENTS = 4;

export const paymentLineSchema = z.object({
  paymentMethodId: z.string().min(1, "Choose a payment method"),
  amount: positiveAmount,
  reference: z.string().trim().max(120, "Reference must be 120 characters or fewer"),
});

type PaymentLine = z.input<typeof paymentLineSchema>;

/** What the lines add up to; an unparsable amount counts as nothing until it is fixed. */
export function receivedPaise(payments: readonly { amount: string }[]): bigint {
  return sumPaise(payments.map(({ amount }) => enteredPaise(amount)));
}

// Payment row: method, reference, amount, remove. Below `md` each cell stacks.
const ROW = "md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem_1.5rem]";

/**
 * The Received section under an Invoice's total. No line is a credit sale. `totalPaise`
 * is the last quoted total, or null until the first quote returns. A stale quote
 * stays visible while the next quote loads, but cannot fill a payment line.
 */
export function InvoicePayments({
  orgSlug,
  totalPaise,
  stale,
}: {
  orgSlug: string;
  totalPaise: bigint | null;
  stale: boolean;
}) {
  const form = useFormContext<{ payments: PaymentLine[] }>();
  const lines = useFieldArray({ control: form.control, name: "payments" });
  const payments = useWatch({ control: form.control, name: "payments" });

  const methods = useQuery(activePaymentMethodsOptions(orgSlug));

  const received = receivedPaise(payments);
  // oxlint-disable-next-line accly/no-paise-arithmetic-in-components -- live remainder of the typed counter-sale payments
  const remaining = totalPaise === null ? null : totalPaise - received;

  // A counter sale is usually cash, so the first line prefers it; each next line takes
  // a method not used yet, pre-filled with what is still owed.
  const used = new Set(payments.map((payment) => payment.paymentMethodId));
  const cash = methods.data?.find((method) => method.name.toLocaleLowerCase() === "cash");
  const next = (payments.length === 0 && cash) || methods.data?.find((row) => !used.has(row.id));

  const addLine = () => {
    if (!next) return;

    lines.append({
      paymentMethodId: next.id,
      amount:
        !stale && remaining !== null && remaining > ZERO_MONEY ? formatDecimal(remaining) : "",
      reference: "",
    });
  };

  const fillLast = () => {
    const last = payments.length - 1;
    const lastPayment = payments[last];

    if (!lastPayment || remaining === null || stale) return;

    form.setValue(
      `payments.${last}.amount`,
      formatDecimal(receivedPaise([lastPayment]) + remaining),
      { shouldDirty: true, shouldValidate: true },
    );
  };

  return (
    <section aria-label="Payment received" className="grid gap-2 border-t border-border pt-3">
      {lines.fields.length > 0 ? (
        <div className={`hidden gap-2 text-muted-foreground md:grid ${ROW}`}>
          <span>Received by</span>
          <span>Reference</span>
          <span className="text-right">Amount</span>
          <span aria-hidden />
        </div>
      ) : null}

      {lines.fields.map((line, index) => (
        <fieldset
          key={line.id}
          className={`grid grid-cols-[minmax(0,1fr)_1.5rem] gap-2 md:items-start ${ROW}`}
        >
          <legend className="sr-only">Payment {index + 1}</legend>
          <div className="col-span-2 md:col-span-1">
            <PaymentMethodField
              orgSlug={orgSlug}
              name={`payments.${index}.paymentMethodId`}
              labelClassName="md:sr-only"
            />
          </div>
          <RegisteredFormField
            name={`payments.${index}.reference`}
            render={({ field }) => (
              <FormItem className="col-span-2 md:col-span-1">
                <FormLabel className="md:sr-only">Reference</FormLabel>
                <FormControl>
                  <Input {...field} maxLength={120} autoComplete="off" placeholder="Optional" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <RegisteredFormField
            name={`payments.${index}.amount`}
            render={({ field }) => (
              <FormItem>
                <FormLabel className="md:sr-only">Amount</FormLabel>
                <FormControl>
                  <AmountInput {...field} required />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="self-end md:mt-1 md:self-start"
            aria-label={`Remove payment ${index + 1}`}
            onClick={() => lines.remove(index)}
          >
            <Trash2Icon />
          </Button>
        </fieldset>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={!next || lines.fields.length >= MAX_PAYMENTS}
          onClick={addLine}
        >
          {lines.fields.length === 0 ? "Record payment" : "Split payment"}
        </Button>
        {lines.fields.length > 0 && remaining !== null && remaining > ZERO_MONEY ? (
          <Button type="button" size="xs" variant="ghost" disabled={stale} onClick={fillLast}>
            <span className={cn("tabular-nums", stale && "opacity-60")}>
              Fill {formatMoney(remaining)}
            </span>
          </Button>
        ) : null}
        {remaining !== null && remaining < ZERO_MONEY ? (
          <span role="status" className="text-destructive tabular-nums">
            Over by {formatMoney(-remaining)}
          </span>
        ) : null}
      </div>

      <FieldArrayError control={form.control} name="payments" />

      {lines.fields.length > 0 && remaining !== null ? (
        <div className="flex items-baseline justify-between gap-4 font-medium">
          <span>Balance due</span>
          <span className={cn("tabular-nums", stale && "opacity-60")}>
            {formatMoney(remaining > ZERO_MONEY ? remaining : ZERO_MONEY)}
          </span>
        </div>
      ) : null}
    </section>
  );
}
