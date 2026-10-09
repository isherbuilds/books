import { computeTds, enteredPaise, formatMoney, isPositiveMoney } from "@accly/api/core/money";
import { REFUND_GRANT } from "@accly/auth/access";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { PaymentWriteOffs } from "@/components/payment-write-offs";
import {
  OpenDocumentsTable,
  SettlementModeField,
  allocationsToPost,
  useOpenDocuments,
} from "@/components/settlement-fields";
import { useZodForm } from "@/hooks/use-zod-form";
import { accountListOptions, postableAccounts } from "@/lib/accounts";
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
import { tdsSectionsOptions } from "@/lib/payments";

// A picked id: the field is empty until something is chosen.
const chosen = (message: string) => z.string().nullish().pipe(z.string(message));

const common = {
  partyName: z.string(),
  amount: positiveAmount,
  paymentMethodId: z.string().min(1, "Choose a payment method"),
  reference: z.string().trim().max(120),
  narration: z.string().trim().max(500),
  documentDate: z.iso.date(),
  // Typed amounts by open document id.
  allocations: z.record(z.string(), z.string()),
};

const schema = z.discriminatedUnion("mode", [
  z.object({
    ...common,
    mode: z.literal("advance"),
    partyId: chosen("Choose a party"),
    tdsSectionId: z.string().nullish(),
  }),
  z
    .object({
      ...common,
      mode: z.literal("against"),
      partyId: chosen("Choose a party"),
      writeOffs: z
        .array(
          z.object({ accountId: chosen("Choose a write-off account"), amount: positiveAmount }),
        )
        .max(5),
      feeAccountId: z.string().nullish(),
      feeAmount: z.string(),
    })
    .superRefine((values, context) => {
      if (
        (values.feeAccountId || values.feeAmount) &&
        !(values.feeAccountId && isPositiveMoney(enteredPaise(values.feeAmount)))
      )
        context.addIssue({
          code: "custom",
          path: ["feeAmount"],
          message: "Choose an expense account and enter a positive fee",
        });
    }),
  z.object({ ...common, mode: z.literal("refund"), partyId: chosen("Choose a party") }),
  z
    .object({
      ...common,
      mode: z.literal("direct"),
      partyId: z.string().nullable(),
      expenseAccountId: chosen("Choose an expense or asset account"),
      tdsSectionId: z.string().nullish(),
    })
    .superRefine((values, context) => {
      if (values.tdsSectionId && !values.partyId)
        context.addIssue({
          code: "custom",
          path: ["partyId"],
          message: "Choose a party to deduct TDS",
        });
    }),
]);

type Values = z.input<typeof schema>;

const SERVER_FIELDS = {
  LOCKED: "documentDate",
  PARTY_INVALID: "partyId",
  PAYMENT_METHOD_INVALID: "paymentMethodId",
  EXPENSE_ACCOUNT_INVALID: "expenseAccountId",
  TDS_SECTION_INVALID: "tdsSectionId",
  TDS_PAN_REQUIRED: "tdsSectionId",
  TDS_PARTY_REQUIRED: "partyId",
  REFUND_AMOUNT_MISMATCH: "allocations",
  ALLOCATION_TARGET_INVALID: "allocations",
  ALLOCATION_SOURCE_INVALID: "allocations",
  ALLOCATION_EXCEEDS_OUTSTANDING: "allocations",
  ALLOCATION_EXCEEDS_SOURCE: "allocations",
} satisfies ServerFields<Values>;

// The receipt's default and order, so both money screens open the same way.
const defaults = (
  today: string,
  party: PartyOption | undefined,
  paymentMethodId = "",
  mode: Values["mode"] = "advance",
): Values => ({
  mode,
  partyId: party?.id ?? null,
  partyName: party?.name ?? "",
  amount: "",
  paymentMethodId,
  allocations: {},
  writeOffs: [],
  feeAmount: "",
  reference: "",
  narration: "",
  documentDate: today,
});

export function PaymentForm({
  orgSlug,
  today,
  initialParty,
  initialExposureSide,
  onClose,
}: {
  orgSlug: string;
  today: string;
  initialParty?: PartyOption;
  initialExposureSide?: "payable" | "receivable";
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const form = useZodForm(schema, {
    defaultValues: defaults(
      today,
      initialParty,
      "",
      initialExposureSide && (initialExposureSide === "payable" ? "against" : "refund"),
    ),
  });

  const mode = useWatch({ control: form.control, name: "mode" });
  const partyId = useWatch({ control: form.control, name: "partyId" });
  const date = useWatch({ control: form.control, name: "documentDate" });
  const tdsSectionId = useWatch({ control: form.control, name: "tdsSectionId" });
  const amount = useWatch({ control: form.control, name: "amount" });
  const writeOffFields = useFieldArray({ control: form.control, name: "writeOffs" });
  const canSettle = useCan(orgSlug, { bill: ["read"] });
  const canRefund = useCan(orgSlug, REFUND_GRANT);
  const open = useOpenDocuments(orgSlug, partyId, mode, "payable");
  const deductsTds = mode === "advance" || mode === "direct";

  const accounts = useQuery(accountListOptions(orgSlug));
  const spendAccounts = accounts.data && postableAccounts(accounts.data, ["expense", "asset"]);
  const expenseAccounts = accounts.data && postableAccounts(accounts.data, ["expense"]);

  const sections = useQuery({
    ...tdsSectionsOptions(orgSlug, date),
    enabled: deductsTds && z.iso.date().safeParse(date).success,
  });

  const section = sections.data?.find((item) => item.id === tdsSectionId);

  const post = useMutation(
    orpc.payment.post.mutationOptions({
      onSuccess: async ({ number }) => {
        await invalidateCashState(queryClient, orgSlug);
        toast.success(`Payment ${number} posted`);
        const { documentDate, paymentMethodId, partyId, partyName } = form.getValues();
        form.reset(
          defaults(
            documentDate,
            partyId ? { id: partyId, name: partyName } : undefined,
            paymentMethodId,
          ),
          { keepSubmitCount: true },
        );
      },
      onError: (error) =>
        handleWriteError(error, {
          settle: () => {
            onClose();

            return invalidateCashState(queryClient, orgSlug);
          },
          fallback: "Could not post the payment",
          uncertain: "The result is uncertain. Check the payment list before entering it again.",
          refuse: async () => {
            applyOrpcFieldError(form, error, SERVER_FIELDS, "Could not post the payment");

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
      documentDate: values.documentDate,
      reference: values.reference,
      narration: values.narration,
    };

    switch (values.mode) {
      case "advance":
        post.mutate({
          ...common,
          settlementKind: "advance",
          partyId: values.partyId,
          tdsSectionId: values.tdsSectionId ?? undefined,
        });

        return;
      case "direct":
        post.mutate({
          ...common,
          settlementKind: "direct",
          partyId: values.partyId ?? undefined,
          expenseAccountId: values.expenseAccountId,
          tdsSectionId: values.tdsSectionId ?? undefined,
        });

        return;
      case "refund": {
        const checked = allocationsToPost(form.setError, open, values, []);

        if (checked)
          post.mutate({
            ...common,
            settlementKind: "against",
            exposureSide: "receivable",
            partyId: values.partyId,
            allocations: checked.selected.map(({ id, amount }) => ({ creditNoteId: id, amount })),
          });

        return;
      }

      case "against": {
        // Write-offs make a bill payment settle in full; a remainder posts as an advance.
        const checked = allocationsToPost(form.setError, open, values, values.writeOffs);

        if (checked)
          post.mutate({
            ...common,
            settlementKind: "against",
            exposureSide: "payable",
            partyId: values.partyId,
            allocations: checked.selected.map(({ id, amount }) => ({ documentId: id, amount })),
            writeOffs: values.writeOffs.length ? values.writeOffs : undefined,
            fee: values.feeAccountId
              ? { accountId: values.feeAccountId, amount: values.feeAmount }
              : undefined,
          });
      }
    }
  });

  const accountField = (
    name: "expenseAccountId" | "feeAccountId",
    label: string,
    choices: typeof accounts.data,
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <LinkField
              items={choices}
              query={accounts}
              noun="accounts"
              getKey={(account) => account.id}
              getLabel={(account) => account.name}
              getCode={(account) => account.code}
              value={choices?.find((account) => account.id === field.value) ?? null}
              onSelect={(account) => field.onChange(account?.id ?? null)}
              inputRef={field.ref}
              placeholder={`Choose ${label.toLowerCase()}`}
            />
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
          onPartyChange={() => form.setValue("allocations", {})}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <RegisteredFormField
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Amount</FormLabel>
                <FormControl>
                  <AmountInput symbol {...field} required />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <PaymentMethodField orgSlug={orgSlug} />
        </div>
        <SettlementModeField
          canAgainst={canSettle}
          canRefund={canRefund}
          refundLabel="Money back to customer"
        />
        {mode === "direct"
          ? accountField("expenseAccountId", "Expense or asset account", spendAccounts)
          : null}
        {(mode === "against" || mode === "refund") && partyId ? (
          <OpenDocumentsTable open={open} adjustmentsName="writeOffs" />
        ) : null}
        {mode === "against" ? (
          <>
            <PaymentWriteOffs orgSlug={orgSlug} writeOffFields={writeOffFields} />
            <div className="grid gap-3 sm:grid-cols-2">
              {accountField("feeAccountId", "Fee expense account (optional)", expenseAccounts)}
              <RegisteredFormField
                name="feeAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fee amount</FormLabel>
                    <FormControl>
                      <AmountInput symbol {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </>
        ) : null}
        {deductsTds ? (
          <FormField
            control={form.control}
            name="tdsSectionId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>TDS section (optional)</FormLabel>
                <FormControl>
                  <LinkField
                    items={sections.data}
                    query={sections}
                    noun="TDS sections"
                    getKey={(item) => item.id}
                    getLabel={(item) => `${item.code} · ${item.description}`}
                    value={section ?? null}
                    onSelect={(item) => field.onChange(item?.id ?? null)}
                    inputRef={field.ref}
                    clearable
                    placeholder="No TDS"
                  />
                </FormControl>
                <FormMessage />
                {section ? (
                  <p className="text-muted-foreground">
                    Section rate: {(section.rateBasisPoints / 100).toFixed(2)}% · Party PAN required
                  </p>
                ) : null}
                {section && isPositiveMoney(enteredPaise(amount)) ? (
                  <p className="tabular-nums">
                    Net paid:{" "}
                    {formatMoney(
                      enteredPaise(amount) -
                        computeTds(enteredPaise(amount), section.rateBasisPoints),
                    )}
                  </p>
                ) : null}
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
