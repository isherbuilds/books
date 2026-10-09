import { REFUND_GRANT } from "@accly/auth/access";
import { DOCUMENT_TYPE_LABELS } from "@accly/api/lib/document-labels";
import { enteredPaise, formatDecimal, isPositiveMoney } from "@accly/api/core/money";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useFieldArray, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ALLOCATION_REFUSALS } from "@/components/allocation-table";
import { AmountInput } from "@/components/amount-input";
import { ReferenceNarrationFields } from "@/components/reference-narration-fields";
import { DocumentForm, PostBar } from "@/components/document-form";
import { LinkField } from "@/components/link-field";
import { DocumentPartyField } from "@/components/party-link-field";
import { PaymentMethodField } from "@/components/payment-method-field";
import { ReceiptAdjustments } from "@/components/receipt-adjustments";
import {
  OpenDocumentsTable,
  SettlementModeField,
  allocationsToPost,
  useOpenDocuments,
} from "@/components/settlement-fields";
import { useZodForm } from "@/hooks/use-zod-form";
import { incomeAccountOptions } from "@/lib/accounts";
import { invalidateCashState, invalidateSettlementState } from "@/lib/domain-invalidation";
import { positiveAmount } from "@/lib/form-schema";
import { useCan } from "@/lib/membership";
import { orpc } from "@/lib/orpc";
import {
  applyOrpcFieldError,
  errorReason,
  handleWriteError,
  type ServerFields,
} from "@/lib/orpc-error";
import type { PartyOption } from "@/lib/parties";

// A picked id: the field is empty until something is chosen.
const chosen = (message: string) => z.string().nullish().pipe(z.string(message));

const ADVANCE_SUPPLIES = ["goods", "exempt", "taxableService"] as const;

const common = {
  partyName: z.string(),
  amount: positiveAmount,
  paymentMethodId: z.string().min(1, "Choose a payment method"),
  reference: z.string().trim().max(120, "Reference must be 120 characters or fewer"),
  narration: z.string().trim().max(500, "Narration must be 500 characters or fewer"),
  documentDate: z.iso.date(),
  // Typed amounts by open document id.
  allocations: z.record(z.string(), z.string()),
};

const receiptSchema = z.discriminatedUnion("mode", [
  z.object({
    ...common,
    mode: z.literal("advance"),
    partyId: chosen("Choose a party"),
    advanceSupply: z
      .enum(ADVANCE_SUPPLIES)
      .nullable()
      .pipe(z.enum(ADVANCE_SUPPLIES, "Choose what the advance is for")),
  }),
  z.object({
    ...common,
    mode: z.literal("against"),
    partyId: chosen("Choose a party"),
    advanceSupply: z.enum(ADVANCE_SUPPLIES).nullable(),
    adjustments: z
      .array(
        z.discriminatedUnion("kind", [
          z.object({
            kind: z.literal("tds"),
            tdsSectionId: chosen("Choose a TDS section"),
            amount: positiveAmount,
          }),
          z.object({
            kind: z.enum(["fee", "writeOff"]),
            accountId: chosen("Choose an expense account"),
            amount: positiveAmount,
          }),
        ]),
      )
      .max(5),
  }),
  z.object({ ...common, mode: z.literal("refund"), partyId: chosen("Choose a party") }),
  z.object({
    ...common,
    mode: z.literal("direct"),
    partyId: z.string().nullable(),
    incomeAccountId: chosen("Choose an income account"),
  }),
]);

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
} satisfies ServerFields<ReceiptFormValues>;

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
    mode: initialRefund ? "refund" : invoice ? "against" : "advance",
    partyId: invoice?.partyId ?? initialParty?.id ?? null,
    partyName: invoice?.partyName ?? initialParty?.name ?? "",
    amount,
    paymentMethodId,
    advanceSupply: null,
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
  const router = useRouter();

  const form = useZodForm(receiptSchema, {
    defaultValues: defaults(today, "", invoice, initialParty, initialRefund),
  });

  const adjustmentFields = useFieldArray({ control: form.control, name: "adjustments" });

  const mode = useWatch({ control: form.control, name: "mode" });
  const partyId = useWatch({ control: form.control, name: "partyId" });
  const documentDate = useWatch({ control: form.control, name: "documentDate" });
  const canRefund = useCan(orgSlug, REFUND_GRANT);
  const loaded = useOpenDocuments(orgSlug, partyId, mode, "receivable");

  // The seeded Invoice can sit past the loaded page of open items. Keep it selectable
  // from its own record; the server still refuses it if it has since been settled. A
  // complete page without it means it is no longer open.
  const open =
    invoice !== undefined &&
    mode === "against" &&
    isPositiveMoney(invoice.outstandingPaise) &&
    partyId === invoice.partyId &&
    loaded.query.hasNextPage &&
    !loaded.rows.some((row) => row.id === invoice.id)
      ? {
          ...loaded,
          rows: [
            ...loaded.rows,
            {
              id: invoice.id,
              label: DOCUMENT_TYPE_LABELS.invoice,
              number: invoice.number,
              reference: invoice.reference,
              documentDate: invoice.documentDate,
              dueDate: invoice.dueDate,
              openPaise: invoice.outstandingPaise,
            },
          ],
        }
      : loaded;

  const incomeAccounts = useQuery(incomeAccountOptions(orgSlug));

  const post = useMutation(
    orpc.receipt.post.mutationOptions({
      onSuccess: async ({ id, number }) => {
        await invalidateCashState(queryClient, orgSlug);
        toast.success(`Receipt ${number} posted`, {
          action: {
            label: "Print",
            onClick: () =>
              window.open(
                router.buildLocation({
                  to: "/api/$orgSlug/receipts/$receiptId/pdf",
                  params: { orgSlug, receiptId: id },
                }).href,
                "_blank",
                "noreferrer",
              ),
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

            // Refresh the shown rows; a seeded Invoice also needs its detail invalidated.
            if (ALLOCATION_REFUSALS.has(errorReason(error)))
              await invalidateSettlementState(queryClient, orgSlug);
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

    switch (values.mode) {
      case "advance":
        post.mutate({
          ...common,
          settlementKind: "advance",
          partyId: values.partyId,
          advanceSupply: values.advanceSupply,
        });

        return;
      case "direct":
        post.mutate({
          ...common,
          settlementKind: "direct",
          partyId: values.partyId ?? undefined,
          incomeAccountId: values.incomeAccountId,
        });

        return;
      case "refund": {
        const checked = allocationsToPost(form.setError, open, values, []);

        if (checked)
          post.mutate({
            ...common,
            settlementKind: "against",
            exposureSide: "payable",
            partyId: values.partyId,
            allocations: checked.selected.map(({ id, amount }) => ({ documentId: id, amount })),
          });

        return;
      }

      case "against": {
        const checked = allocationsToPost(form.setError, open, values, values.adjustments);

        if (!checked) return;

        if (checked.partial && !values.advanceSupply) {
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
          allocations: checked.selected.map(({ id, amount }) => ({ documentId: id, amount })),
          adjustments: values.adjustments,
          advanceSupply: values.advanceSupply ?? undefined,
        });
      }
    }
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
          label={`Party${mode === "direct" ? " (optional)" : ""}`}
          role={open.partyRole}
          clearable={mode === "direct"}
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

        <SettlementModeField
          canAgainst
          canRefund={canRefund}
          refundLabel="Money back from supplier"
        />

        {mode === "advance" ? advanceSupplyField : null}

        {mode === "against" && partyId ? (
          <ReceiptAdjustments
            orgSlug={orgSlug}
            documentDate={documentDate}
            adjustmentFields={adjustmentFields}
          />
        ) : null}

        {(mode === "against" || mode === "refund") && partyId ? (
          <OpenDocumentsTable
            open={open}
            adjustmentsName="adjustments"
            advanceField={advanceSupplyField}
          />
        ) : null}

        {mode === "direct" ? (
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
