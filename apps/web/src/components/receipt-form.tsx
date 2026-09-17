import { NON_NEGATIVE_MONEY_PATTERN, formatMoney, parseMoney } from "@accly/api/core/money";
import { Button, buttonVariants } from "@accly/ui/components/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@accly/ui/components/form";
import { Input } from "@accly/ui/components/input";
import { NativeSelect } from "@accly/ui/components/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@accly/ui/components/table";
import { Textarea } from "@accly/ui/components/textarea";
import { ToggleGroup, ToggleGroupItem } from "@accly/ui/components/toggle-group";
import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Watch, useWatch, type FieldPath } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { DocumentForm, LineGrid, PostBar, PostedView } from "@/components/document-form";
import { LinkField } from "@/components/link-field";
import { ErrorNote } from "@/components/page";
import { PartyLinkField } from "@/components/party-link-field";
import { useZodForm } from "@/hooks/use-zod-form";
import { incomeAccountOptions } from "@/lib/accounts";
import { invalidateCashState } from "@/lib/domain-invalidation";
import { orpc } from "@/lib/orpc";
import { formatDay } from "@/lib/org-datetime";
import { applyOrpcFieldError, errorReason, isRefusal } from "@/lib/orpc-error";
import { paymentMethodListOptions } from "@/lib/receipts";

function enteredPaise(value: string): bigint {
  if (!NON_NEGATIVE_MONEY_PATTERN.test(value)) return 0n;

  return parseMoney(value);
}

const receiptSchema = z
  .object({
    partyId: z.string().nullable(),
    partyName: z.string(),
    amount: z
      .string()
      .regex(NON_NEGATIVE_MONEY_PATTERN, "Enter a valid amount")
      .refine((value) => Number(value) > 0, "Amount must be greater than zero"),
    paymentMethodId: z.string().min(1, "Choose a payment method"),
    settlementKind: z.enum(["advance", "against", "direct"]),
    advanceSupply: z.enum(["goods", "exempt", "taxableService"]).nullable(),
    // Typed amounts by Invoice id. These are the operator's intent, so submit sends
    // exactly the non-empty entries and refuses when one is no longer open.
    allocations: z.record(z.string(), z.string()),
    incomeAccountId: z.string().nullable(),
    reference: z.string().trim().max(120, "Reference must be 120 characters or fewer"),
    narration: z.string().trim().max(500, "Narration must be 500 characters or fewer"),
    documentDate: z.iso.date(),
  })
  .superRefine((values, context) => {
    if (values.settlementKind !== "direct" && !values.partyId) {
      context.addIssue({ code: "custom", path: ["partyId"], message: "Choose a party" });
    }

    if (values.settlementKind === "advance" && !values.advanceSupply) {
      context.addIssue({
        code: "custom",
        path: ["advanceSupply"],
        message: "Choose what the advance is for",
      });
    }

    if (values.settlementKind === "direct" && !values.incomeAccountId) {
      context.addIssue({
        code: "custom",
        path: ["incomeAccountId"],
        message: "Choose an income account",
      });
    }
  });

type ReceiptFormValues = z.input<typeof receiptSchema>;

const SERVER_FIELDS = {
  PARTY_INVALID: "partyId",
  PAYMENT_METHOD_INVALID: "paymentMethodId",
  INCOME_ACCOUNT_INVALID: "incomeAccountId",
  TAXABLE_DIRECT_RECEIPT: "incomeAccountId",
  ADVANCE_TAX_UNSUPPORTED: "advanceSupply",
  ADVANCE_SUPPLY_REQUIRED: "advanceSupply",
  ALLOCATION_EXCEEDS_SOURCE: "allocations",
  ALLOCATION_TARGET_INVALID: "allocations",
  ALLOCATION_EXCEEDS_OUTSTANDING: "allocations",
} satisfies Record<string, FieldPath<ReceiptFormValues>>;

function defaults(today: string, paymentMethodId = ""): ReceiptFormValues {
  return {
    partyId: null,
    partyName: "",
    amount: "",
    paymentMethodId,
    settlementKind: "advance",
    advanceSupply: null,
    incomeAccountId: null,
    allocations: {},
    reference: "",
    narration: "",
    documentDate: today,
  };
}

export function ReceiptForm({
  orgSlug,
  today,
  onClose,
}: {
  orgSlug: string;
  today: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const form = useZodForm(receiptSchema, { defaultValues: defaults(today) });
  const settlementKind = useWatch({ control: form.control, name: "settlementKind" });
  const partyId = useWatch({ control: form.control, name: "partyId" });

  const openInvoices = useQuery(
    orpc.invoice.openInvoices.queryOptions({
      input: settlementKind === "against" && partyId ? { orgSlug, partyId } : skipToken,
    }),
  );

  const openRows = openInvoices.data?.rows ?? [];

  // The receipts list's cache entry; only an active method can take a new receipt.
  const paymentMethods = useQuery({
    ...paymentMethodListOptions(orgSlug),
    select: (methods) => methods.filter((method) => method.active),
  });

  const incomeAccounts = useQuery(incomeAccountOptions(orgSlug));

  useEffect(() => {
    if (form.getValues("paymentMethodId") || !paymentMethods.data?.length) return;

    const preferred =
      paymentMethods.data.find((method) => method.name.toLocaleLowerCase() === "bank transfer") ??
      paymentMethods.data[0];

    form.setValue("paymentMethodId", preferred.id);
  }, [form, paymentMethods.data]);

  const post = useMutation(
    orpc.receipt.post.mutationOptions({
      onSuccess: async () => {
        await invalidateCashState(queryClient, orgSlug);
      },
      onError: async (error) => {
        // Retrying could post it twice; the list shows whether it went through.
        if (!isRefusal(error)) {
          onClose();
          await invalidateCashState(queryClient, orgSlug);
          toast.error("The result is uncertain. Check the receipt list before entering it again.");

          return;
        }

        applyOrpcFieldError(form, error, SERVER_FIELDS, "Could not post the receipt");

        const reason = errorReason(error);

        // The outstanding amounts on screen are stale.
        if (reason === "ALLOCATION_TARGET_INVALID" || reason === "ALLOCATION_EXCEEDS_OUTSTANDING") {
          await openInvoices.refetch();
        }
      },
    }),
  );

  // Held until "Post and next" resets the mutation.
  const posted = post.data;

  const submit = form.handleSubmit((values) => {
    const common = {
      orgSlug,
      amount: values.amount,
      paymentMethodId: values.paymentMethodId,
      reference: values.reference,
      narration: values.narration,
      documentDate: values.documentDate,
    };

    if (values.settlementKind === "advance") {
      if (!values.partyId || !values.advanceSupply) return;

      post.mutate({
        ...common,
        settlementKind: "advance",
        partyId: values.partyId,
        advanceSupply: values.advanceSupply,
      });

      return;
    }

    if (values.settlementKind === "against") {
      if (!values.partyId) return;

      const allocations: { invoiceId: string; amount: string }[] = [];
      let allocatedPaise = 0n;
      let invalid = false;

      for (const [invoiceId, amount] of Object.entries(values.allocations)) {
        if (amount === "") continue;

        const invoice = openRows.find((row) => row.id === invoiceId);

        if (!invoice) {
          form.setError(
            `allocations.${invoiceId}`,
            { message: "This invoice is no longer open. Clear the amount to continue." },
            { shouldFocus: !invalid },
          );
          invalid = true;
          continue;
        }

        const amountPaise = enteredPaise(amount);

        const message = !NON_NEGATIVE_MONEY_PATTERN.test(amount)
          ? "Enter a valid amount"
          : amountPaise === 0n
            ? "Amount must be greater than zero"
            : amountPaise > invoice.outstandingPaise
              ? `Enter no more than ${formatMoney(invoice.outstandingPaise)}`
              : undefined;

        if (message) {
          form.setError(`allocations.${invoiceId}`, { message }, { shouldFocus: !invalid });
          invalid = true;
        } else {
          allocations.push({ invoiceId, amount });
          allocatedPaise += amountPaise;
        }
      }

      if (invalid) {
        toast.error("Check the allocated amounts before posting.");

        return;
      }

      const receiptPaise = parseMoney(values.amount);

      const tableError =
        allocations.length === 0
          ? "Allocate the receipt to at least one invoice"
          : allocations.length > 50
            ? "Allocate to no more than 50 invoices"
            : allocatedPaise > receiptPaise
              ? "Allocated amount cannot exceed the receipt amount"
              : undefined;

      if (tableError) {
        form.setError("allocations", { message: tableError });

        return;
      }

      if (allocatedPaise < receiptPaise && !values.advanceSupply) {
        form.setError(
          "advanceSupply",
          { message: "Choose what the remaining advance is for" },
          { shouldFocus: true },
        );

        return;
      }

      post.mutate({
        ...common,
        settlementKind: "against",
        partyId: values.partyId,
        allocations,
        advanceSupply: values.advanceSupply ?? undefined,
      });

      return;
    }

    if (!values.incomeAccountId) return;

    post.mutate({
      ...common,
      settlementKind: "direct",
      partyId: values.partyId ?? undefined,
      incomeAccountId: values.incomeAccountId,
    });
  });

  if (posted) {
    return (
      <PostedView
        number={posted.number}
        onDone={onClose}
        onNext={() => {
          const { documentDate, paymentMethodId } = form.getValues();
          form.reset(defaults(documentDate, paymentMethodId));
          post.reset();
          // Base UI returns focus to the Sheet when this button unmounts; land after it.
          setTimeout(() => form.setFocus("partyId"), 50);
        }}
      >
        <a
          href={`/api/${orgSlug}/receipts/${posted.id}/pdf`}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: "outline", className: "mx-auto" })}
        >
          Print
        </a>
      </PostedView>
    );
  }

  // Advance receipts always ask; against receipts ask only for an unallocated remainder.
  const advanceSupplyField = (
    <FormField
      control={form.control}
      name="advanceSupply"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Advance for</FormLabel>
          <FormControl>
            <NativeSelect
              name={field.name}
              ref={field.ref}
              onBlur={field.onBlur}
              value={field.value ?? ""}
              onChange={(event) =>
                field.onChange(event.target.value === "" ? null : event.target.value)
              }
              required
            >
              <option value="" disabled>
                Choose supply
              </option>
              <option value="goods">Goods</option>
              <option value="exempt">Exempt supply</option>
              <option value="taxableService">Taxable service</option>
            </NativeSelect>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Form {...form}>
      <DocumentForm
        pending={post.isPending}
        onSubmit={(event) => void submit(event)}
        footer={
          <PostBar onClose={onClose} closeLabel="Cancel">
            <Button type="submit">
              {post.isPending ? "Posting…" : post.isError ? "Post again" : "Post"}
              <span className="text-[0.625rem] opacity-70">⌘↵</span>
            </Button>
          </PostBar>
        }
      >
        <FormField
          control={form.control}
          name="partyId"
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel>Party{settlementKind === "direct" ? " (optional)" : ""}</FormLabel>
              <FormControl>
                <PartyLinkField
                  orgSlug={orgSlug}
                  value={
                    field.value ? { id: field.value, name: form.getValues("partyName") } : null
                  }
                  onSelect={(party) => {
                    if (party?.id !== field.value) form.setValue("allocations", {});
                    field.onChange(party?.id ?? null);
                    form.setValue("partyName", party?.name ?? "");
                  }}
                  inputRef={field.ref}
                  clearable={settlementKind === "direct"}
                  aria-invalid={fieldState.invalid}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <RegisteredFormField
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Amount</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    required
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

          <FormField
            control={form.control}
            name="paymentMethodId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Payment method</FormLabel>
                <FormControl>
                  <NativeSelect {...field} required>
                    <option value="" disabled>
                      {paymentMethods.isPending
                        ? "Loading payment methods…"
                        : paymentMethods.isError
                          ? "Could not load payment methods"
                          : "Choose a payment method"}
                    </option>
                    {paymentMethods.data?.map((method) => (
                      <option key={method.id} value={method.id}>
                        {method.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="settlementKind"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Settlement kind</FormLabel>
              <FormControl>
                <ToggleGroup
                  value={[field.value]}
                  onValueChange={(next) => {
                    const value = next[0];

                    if (value === "advance" || value === "against" || value === "direct") {
                      field.onChange(value);
                    }
                  }}
                  spacing={1}
                  variant="outline"
                  aria-label="Settlement kind"
                >
                  <ToggleGroupItem value="advance">Advance</ToggleGroupItem>
                  <ToggleGroupItem value="against">Against invoices</ToggleGroupItem>
                  <ToggleGroupItem value="direct">Direct</ToggleGroupItem>
                </ToggleGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {settlementKind === "advance" ? advanceSupplyField : null}

        {settlementKind === "against" && partyId ? (
          <>
            <FormField
              control={form.control}
              name="allocations"
              render={() => (
                <FormItem>
                  <LineGrid title="Open invoices">
                    {openInvoices.isPending ? (
                      <p className="text-xs text-muted-foreground">Loading open invoices…</p>
                    ) : openInvoices.isError ? (
                      <ErrorNote title="Could not load open invoices" error={openInvoices.error} />
                    ) : openRows.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No open invoices.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Invoice</TableHead>
                            <TableHead className="text-right">Outstanding</TableHead>
                            <TableHead className="w-28 text-right">Allocate</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {openRows.map((invoice) => (
                            <TableRow key={invoice.id}>
                              <TableCell className="whitespace-normal">
                                <p className="font-mono">{invoice.number}</p>
                                <p className="text-[0.6875rem] text-muted-foreground">
                                  {formatDay(invoice.documentDate)}
                                  {invoice.dueDate ? ` · Due ${formatDay(invoice.dueDate)}` : null}
                                </p>
                              </TableCell>
                              <TableCell className="text-right">
                                {formatMoney(invoice.outstandingPaise)}
                              </TableCell>
                              <TableCell className="w-28">
                                <RegisteredFormField
                                  name={`allocations.${invoice.id}`}
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel className="sr-only">
                                        Amount for invoice {invoice.number}
                                      </FormLabel>
                                      <FormControl>
                                        <Input
                                          {...field}
                                          inputMode="decimal"
                                          autoComplete="off"
                                          pattern={NON_NEGATIVE_MONEY_PATTERN.source}
                                          placeholder="0.00"
                                          className="h-7 text-right tabular-nums"
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                    {openInvoices.data?.hasMore ? (
                      <p className="text-xs text-muted-foreground">
                        Showing the 200 oldest open invoices. Apply the rest from the invoice.
                      </p>
                    ) : null}
                  </LineGrid>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* The only subscriber to the typed amounts, so a keystroke re-renders the
                totals and the supply field, never the invoice rows. */}
            <Watch
              control={form.control}
              name={["amount", "allocations"]}
              render={([amount, allocations]) => {
                // Totals over what was typed, not over the open rows, so an amount for
                // an invoice that has since closed still counts against the remainder.
                const allocatedPaise = Object.values(allocations).reduce(
                  (total, entered) => total + enteredPaise(entered),
                  0n,
                );

                const remainingPaise = enteredPaise(amount) - allocatedPaise;

                return (
                  <>
                    <dl className="grid gap-1 border-t border-border pt-2 text-xs">
                      <div className="flex items-baseline justify-between gap-4">
                        <dt className="text-muted-foreground">Allocated</dt>
                        <dd className="tabular-nums">{formatMoney(allocatedPaise)}</dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-4 font-medium">
                        <dt>Remaining as advance</dt>
                        <dd className="tabular-nums">{formatMoney(remainingPaise)}</dd>
                      </div>
                    </dl>
                    {remainingPaise > 0n ? advanceSupplyField : null}
                  </>
                );
              }}
            />
          </>
        ) : null}

        {settlementKind === "direct" ? (
          <FormField
            control={form.control}
            name="incomeAccountId"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel>Income account</FormLabel>
                <FormControl>
                  <LinkField
                    items={incomeAccounts.data}
                    query={incomeAccounts}
                    noun="income accounts"
                    getKey={(account) => account.id}
                    getLabel={(account) => account.name}
                    getCode={(account) => account.code}
                    value={
                      incomeAccounts.data?.find((account) => account.id === field.value) ?? null
                    }
                    onSelect={(account) => field.onChange(account?.id ?? null)}
                    inputRef={field.ref}
                    placeholder="Choose an income account"
                    aria-invalid={fieldState.invalid}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}

        <RegisteredFormField
          name="reference"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Reference</FormLabel>
              <FormControl>
                <Input {...field} maxLength={120} autoComplete="off" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <RegisteredFormField
          name="narration"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Narration</FormLabel>
              <FormControl>
                <Textarea {...field} maxLength={500} rows={3} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <RegisteredFormField
          name="documentDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Date</FormLabel>
              <FormControl>
                <Input {...field} required type="date" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </DocumentForm>
    </Form>
  );
}
