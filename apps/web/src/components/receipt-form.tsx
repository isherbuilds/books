import { SUPPLIER_REFUND_GRANT } from "@accly/auth/access";
import { documentLabel } from "@accly/api/lib/document-labels";
import {
  ZERO_MONEY,
  enteredPaise,
  formatDecimal,
  isPositiveMoney,
  parseMoney,
} from "@accly/api/core/money";
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
import { ToggleGroup, ToggleGroupItem } from "@accly/ui/components/toggle-group";
import {
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useFieldArray, useWatch, type FieldPath } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  ALLOCATION_REFUSALS,
  AllocationTable,
  SettlementAllocationTotals,
  checkAllocations,
  reportRowErrors,
  settlementRemaining,
  type OpenDocument,
} from "@/components/allocation-table";
import { AmountInput } from "@/components/amount-input";
import { ReferenceNarrationFields } from "@/components/reference-narration-fields";
import { DocumentForm, PostBar } from "@/components/document-form";
import { LinkField } from "@/components/link-field";
import { DocumentPartyField } from "@/components/party-link-field";
import { PaymentMethodField } from "@/components/payment-method-field";
import { ReceiptAdjustments } from "@/components/receipt-adjustments";
import { useZodForm } from "@/hooks/use-zod-form";
import { incomeAccountOptions } from "@/lib/accounts";
import { invalidateCashState, invalidateSettlementState } from "@/lib/domain-invalidation";
import { orpc } from "@/lib/orpc";
import { openCreditsOptions, openItemsOptions } from "@/lib/pickers";

import { applyOrpcFieldError, errorReason, handleWriteError } from "@/lib/orpc-error";
import { positiveAmount } from "@/lib/form-schema";

import { useCan } from "@/lib/membership";
import type { PartyOption } from "@/lib/parties";

const receiptSchema = z
  .object({
    partyId: z.string().nullable(),
    partyName: z.string(),
    amount: positiveAmount,
    paymentMethodId: z.string().min(1, "Choose a payment method"),
    settlementKind: z.enum(["advance", "against", "direct"]),
    exposureSide: z.enum(["receivable", "payable"]),
    advanceSupply: z.enum(["goods", "exempt", "taxableService"]).nullable(),
    // Typed amounts by open item id.
    allocations: z.record(z.string(), z.string()),
    adjustments: z
      .array(
        z.object({
          kind: z.enum(["fee", "writeOff", "tds"]),
          accountId: z.string().nullable(),
          amount: positiveAmount,
          tdsSectionId: z.string().nullable(),
        }),
      )
      .max(5),
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

    values.adjustments.forEach((adjustment, index) => {
      if (values.settlementKind !== "against") return;

      if (adjustment.kind === "tds" && !adjustment.tdsSectionId) {
        context.addIssue({
          code: "custom",
          path: ["adjustments", index, "tdsSectionId"],
          message: "Choose a TDS section",
        });
      } else if (adjustment.kind !== "tds" && !adjustment.accountId) {
        context.addIssue({
          code: "custom",
          path: ["adjustments", index, "accountId"],
          message: "Choose an expense account",
        });
      }
    });
  });

type ReceiptFormValues = z.input<typeof receiptSchema>;

const SERVER_FIELDS = {
  LOCKED: "documentDate",
  PARTY_INVALID: "partyId",
  PAYMENT_METHOD_INVALID: "paymentMethodId",
  INCOME_ACCOUNT_INVALID: "incomeAccountId",
  TAXABLE_DIRECT_RECEIPT: "incomeAccountId",
  ADVANCE_TAX_UNSUPPORTED: "advanceSupply",
  ADVANCE_SUPPLY_REQUIRED: "advanceSupply",
  REFUND_AMOUNT_MISMATCH: "allocations",
  ALLOCATION_EXCEEDS_SOURCE: "allocations",
  ALLOCATION_SOURCE_INVALID: "allocations",
  ALLOCATION_TARGET_INVALID: "allocations",
  ALLOCATION_EXCEEDS_OUTSTANDING: "allocations",
  ADJUSTMENT_UNALLOCATED: "allocations",
  ADJUSTMENT_ACCOUNT_INVALID: "adjustments",
  TDS_SECTION_INVALID: "adjustments",
} satisfies Record<string, FieldPath<ReceiptFormValues>>;

/** A posted Invoice the receipt settles, as its record showed it. */
export type ReceiptInvoice = {
  id: string;
  number: string;
  reference: string | null;
  documentDate: string;
  dueDate: string | null;
  partyId: string;
  partyName: string;
  outstandingPaise: bigint;
};

// From an Invoice, the receipt starts against it for its whole outstanding.
function defaults(
  today: string,
  paymentMethodId = "",
  invoice?: ReceiptInvoice,
  initialParty?: PartyOption,
  initialRefund?: boolean,
): ReceiptFormValues {
  const amount = invoice ? formatDecimal(invoice.outstandingPaise) : "";

  return {
    partyId: invoice?.partyId ?? initialParty?.id ?? null,
    partyName: invoice?.partyName ?? initialParty?.name ?? "",
    amount,
    paymentMethodId,
    settlementKind: invoice || initialRefund ? "against" : "advance",
    exposureSide: initialRefund ? "payable" : "receivable",
    advanceSupply: null,
    incomeAccountId: null,
    allocations: invoice ? { [invoice.id]: amount } : {},
    adjustments: [],
    reference: "",
    narration: "",
    documentDate: today,
  };
}

export function ReceiptForm({
  orgSlug,
  today,
  invoice,
  onClose,
  initialParty,
  initialRefund,
}: {
  orgSlug: string;
  today: string;
  invoice?: ReceiptInvoice;
  initialParty?: PartyOption;
  initialRefund?: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const form = useZodForm(receiptSchema, {
    defaultValues: defaults(today, "", invoice, initialParty, initialRefund),
  });

  const adjustmentFields = useFieldArray({ control: form.control, name: "adjustments" });

  const settlementKind = useWatch({ control: form.control, name: "settlementKind" });
  const exposureSide = useWatch({ control: form.control, name: "exposureSide" });
  const isRefund = settlementKind === "against" && exposureSide === "payable";
  const partyId = useWatch({ control: form.control, name: "partyId" });
  const documentDate = useWatch({ control: form.control, name: "documentDate" });
  const canRefund = useCan(orgSlug, SUPPLIER_REFUND_GRANT);

  const openItems = useInfiniteQuery(
    openItemsOptions(
      settlementKind === "against" && !isRefund && partyId
        ? { orgSlug, partyId, side: "receivable" }
        : skipToken,
    ),
  );

  const credits = useInfiniteQuery(
    openCreditsOptions(
      isRefund && partyId
        ? { orgSlug, partyId, side: "payable", types: ["debitNote", "payment"] }
        : skipToken,
    ),
  );

  const loadedRows: OpenDocument[] =
    openItems.data?.pages
      .flatMap((page) => page.rows)
      .map((row) => ({
        ...row,
        label: documentLabel(row.type, "receivable"),
        openPaise: row.outstandingPaise,
      })) ?? [];

  // The seeded Invoice can sit past the loaded page of open items. Keep it selectable
  // from its own record; the server still refuses it if it has since been settled. A
  // complete page without it means it is no longer open.
  const seedMissing =
    invoice !== undefined &&
    isPositiveMoney(invoice.outstandingPaise) &&
    partyId === invoice.partyId &&
    openItems.hasNextPage &&
    !loadedRows.some((row) => row.id === invoice.id);

  const openRows: OpenDocument[] = isRefund
    ? (credits.data?.pages
        .flatMap((page) => page.rows)
        .map((row) => ({
          ...row,
          label: row.type === "debitNote" ? "Debit note" : "Advance paid",
          dueDate: null,
          openPaise: row.unappliedPaise,
        })) ?? [])
    : seedMissing
      ? [
          ...loadedRows,
          {
            id: invoice.id,
            label: "Invoice",
            number: invoice.number,
            reference: invoice.reference,
            documentDate: invoice.documentDate,
            dueDate: invoice.dueDate,
            openPaise: invoice.outstandingPaise,
          },
        ]
      : loadedRows;

  const incomeAccounts = useQuery(incomeAccountOptions(orgSlug));

  const post = useMutation(
    orpc.receipt.post.mutationOptions({
      onSuccess: async ({ id, number }) => {
        await invalidateCashState(queryClient, orgSlug);
        toast.success(`Receipt ${number} posted`, {
          action: {
            label: "Print",
            onClick: () =>
              window.open(`/api/${orgSlug}/receipts/${id}/pdf`, "_blank", "noreferrer"),
          },
        });

        // A receipt against one Invoice is done; a fresh receipt clears for the next one.
        if (invoice || initialRefund) {
          onClose();

          return;
        }

        const { documentDate, paymentMethodId } = form.getValues();
        form.reset(defaults(documentDate, paymentMethodId), { keepSubmitCount: true });
      },
      // Retrying could post it twice; the list shows whether it went through.
      onError: (error) =>
        handleWriteError(error, {
          settle: () => {
            onClose();

            return invalidateCashState(queryClient, orgSlug);
          },
          fallback: "Could not post the receipt",
          uncertain: "The result is uncertain. Check the receipt list before entering it again.",
          refuse: async () => {
            applyOrpcFieldError(form, error, SERVER_FIELDS, "Could not post the receipt");

            // Refresh the displayed rows; a seeded Invoice also needs its detail invalidated.
            if (ALLOCATION_REFUSALS.includes(errorReason(error) ?? "")) {
              if (isRefund) await credits.refetch();
              else await invalidateSettlementState(queryClient, orgSlug);
            }
          },
        }),
    }),
  );

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

      const openQuery = values.exposureSide === "payable" ? credits : openItems;

      if (!openQuery.isSuccess || openQuery.isFetching) {
        form.setError("allocations", { message: "Wait for the open documents to load" });

        return;
      }

      const { selected, allocatedPaise, rowErrors, tableError } = checkAllocations(
        values.allocations,
        openRows,
      );

      if (reportRowErrors(form.setError, rowErrors)) return;

      const receiptPaise = parseMoney(values.amount);

      if (values.exposureSide === "payable") {
        if (tableError || allocatedPaise !== receiptPaise) {
          form.setError("allocations", {
            message: tableError ?? "Amount must match the total you picked below",
          });

          return;
        }

        post.mutate({
          ...common,
          settlementKind: "against",
          exposureSide: "payable",
          partyId: values.partyId,
          allocations: selected.map(({ id, amount }) => ({ documentId: id, amount })),
        });

        return;
      }

      const adjustments = values.adjustments.map((adjustment) =>
        adjustment.kind === "tds"
          ? {
              kind: "tds" as const,
              amount: adjustment.amount,
              tdsSectionId: adjustment.tdsSectionId!,
            }
          : { kind: adjustment.kind, accountId: adjustment.accountId!, amount: adjustment.amount },
      );

      const capacityPaise =
        receiptPaise +
        adjustments.reduce(
          (total, adjustment) => total + parseMoney(adjustment.amount),
          ZERO_MONEY,
        );

      const allocationError =
        tableError ??
        (allocatedPaise > capacityPaise
          ? "Allocated amount cannot exceed the receipt and adjustments"
          : adjustments.length > 0 && allocatedPaise !== capacityPaise
            ? "Allocate the full receipt and adjustments"
            : undefined);

      if (allocationError) {
        form.setError("allocations", { message: allocationError });

        return;
      }

      if (allocatedPaise < capacityPaise && !values.advanceSupply) {
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
        exposureSide: "receivable",
        partyId: values.partyId,
        allocations: selected.map(({ id, amount }) => ({ documentId: id, amount })),
        adjustments,
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
        // Each post remounts the fields, so the next entry starts on the first field.
        key={post.data?.id}
        pending={post.isPending}
        onSubmit={(event) => void submit(event)}
        footer={<PostBar onClose={onClose} post={post} />}
      >
        <DocumentPartyField
          orgSlug={orgSlug}
          label={`Party${settlementKind === "direct" ? " (optional)" : ""}`}
          role={isRefund ? "vendor" : "customer"}
          clearable={settlementKind === "direct"}
          // Allocations belong to the party's open items.
          onPartyChange={() => form.setValue("allocations", {})}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <RegisteredFormField
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Amount</FormLabel>
                <FormControl>
                  <AmountInput
                    symbol
                    {...field}
                    // A receipt from an Invoice moves its allocation too, up to the
                    // outstanding, until the operator types a different allocation. The
                    // remainder posts as an advance.
                    onChange={(event) => {
                      if (invoice) {
                        const seeded = (amount: string) =>
                          enteredPaise(amount) > invoice.outstandingPaise
                            ? formatDecimal(invoice.outstandingPaise)
                            : amount;

                        if (
                          form.getValues(`allocations.${invoice.id}`) ===
                          seeded(form.getValues("amount"))
                        ) {
                          form.setValue(`allocations.${invoice.id}`, seeded(event.target.value));
                        }
                      }

                      void field.onChange(event);
                    }}
                    required
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <PaymentMethodField orgSlug={orgSlug} />
        </div>

        <FormField
          control={form.control}
          name="settlementKind"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Settlement kind</FormLabel>
              <FormControl>
                <ToggleGroup
                  value={[field.value === "against" && isRefund ? "against:payable" : field.value]}
                  onValueChange={(next) => {
                    const value = next[0];

                    if (
                      value === "advance" ||
                      value === "against" ||
                      value === "direct" ||
                      value === "against:payable"
                    ) {
                      if (value !== "against") adjustmentFields.remove();
                      form.setValue("allocations", {});
                      form.setValue(
                        "exposureSide",
                        value === "against:payable" ? "payable" : "receivable",
                      );
                      field.onChange(value === "against:payable" ? "against" : value);
                    }
                  }}
                  spacing={1}
                  variant="outline"
                  aria-label="Settlement kind"
                  className="flex-wrap"
                >
                  <ToggleGroupItem value="advance">Advance</ToggleGroupItem>
                  <ToggleGroupItem value="against">Against open items</ToggleGroupItem>
                  <ToggleGroupItem value="direct">Direct</ToggleGroupItem>
                  {canRefund ? (
                    <ToggleGroupItem value="against:payable">
                      Money back from supplier
                    </ToggleGroupItem>
                  ) : null}
                </ToggleGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {settlementKind === "advance" ? advanceSupplyField : null}

        {settlementKind === "against" && !isRefund && partyId ? (
          <>
            <ReceiptAdjustments
              orgSlug={orgSlug}
              documentDate={documentDate}
              adjustmentFields={adjustmentFields}
            />

            <AllocationTable
              title="Open items"
              openHeading="Outstanding"
              query={openItems}
              rows={openRows}
              name="allocations"
              remainingFor={(documentId) =>
                settlementRemaining(
                  form.getValues("amount"),
                  form.getValues("allocations"),
                  form.getValues("adjustments"),
                  documentId,
                )
              }
            >
              <SettlementAllocationTotals
                adjustmentsName="adjustments"
                advanceRemainder
                advanceField={advanceSupplyField}
              />
            </AllocationTable>
          </>
        ) : null}

        {isRefund && partyId ? (
          <AllocationTable
            title="What this supplier owes you"
            openHeading="Owed to you"
            query={credits}
            rows={openRows}
            name="allocations"
            remainingFor={(documentId) =>
              settlementRemaining(
                form.getValues("amount"),
                form.getValues("allocations"),
                [],
                documentId,
              )
            }
          >
            <SettlementAllocationTotals adjustmentsName={null} advanceRemainder={false} />
          </AllocationTable>
        ) : null}

        {settlementKind === "direct" ? (
          <FormField
            control={form.control}
            name="incomeAccountId"
            render={({ field }) => (
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
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}

        <ReferenceNarrationFields />

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
