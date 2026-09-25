import {
  NON_NEGATIVE_MONEY_PATTERN,
  ZERO_MONEY,
  enteredPaise,
  isPositiveMoney,
  parseMoney,
} from "@accly/api/core/money";
import { Button } from "@accly/ui/components/button";
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
import { Kbd } from "@accly/ui/components/kbd";
import { Textarea } from "@accly/ui/components/textarea";
import { ToggleGroup, ToggleGroupItem } from "@accly/ui/components/toggle-group";
import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useFieldArray, useWatch, type FieldPath } from "react-hook-form";
import { z } from "zod";

import {
  AllocationTable,
  checkAllocations,
  reportRowErrors,
  type OpenDocument,
} from "@/components/allocation-table";
import { DocumentForm, PostBar, PostedView } from "@/components/document-form";
import { LinkField } from "@/components/link-field";
import { DocumentPartyField } from "@/components/party-link-field";
import { PaymentMethodField } from "@/components/payment-method-field";
import { PaymentWriteOffs } from "@/components/payment-write-offs";
import { useZodForm } from "@/hooks/use-zod-form";
import { accountListOptions, postableAccounts } from "@/lib/accounts";
import { invalidateCashState } from "@/lib/domain-invalidation";
import { positiveAmount } from "@/lib/form-schema";
import { useCan } from "@/lib/membership";
import { orpc } from "@/lib/orpc";
import { applyOrpcFieldError, errorReason, handleWriteError } from "@/lib/orpc-error";
import { partyPickerOptions } from "@/lib/parties";

const schema = z
  .object({
    partyId: z.string().nullable(),
    partyName: z.string(),
    amount: positiveAmount,
    paymentMethodId: z.string().min(1, "Choose a payment method"),
    settlementKind: z.enum(["advance", "against", "direct"]),
    exposureSide: z.enum(["payable", "receivable"]),
    allocations: z.record(z.string(), z.string()),
    expenseAccountId: z.string().nullable(),
    tdsSectionId: z.string().nullable(),
    feeAccountId: z.string().nullable(),
    feeAmount: z.string(),
    writeOffs: z
      .array(z.object({ accountId: z.string().nullable(), amount: positiveAmount }))
      .max(5),
    reference: z.string().trim().max(120),
    narration: z.string().trim().max(500),
    documentDate: z.iso.date(),
  })
  .superRefine((values, context) => {
    if (values.settlementKind !== "direct" && !values.partyId)
      context.addIssue({ code: "custom", path: ["partyId"], message: "Choose a party" });

    if (values.settlementKind === "direct" && !values.expenseAccountId)
      context.addIssue({
        code: "custom",
        path: ["expenseAccountId"],
        message: "Choose an expense or asset account",
      });

    if (values.tdsSectionId && values.settlementKind !== "against" && !values.partyId)
      context.addIssue({
        code: "custom",
        path: ["partyId"],
        message: "Choose a party to deduct TDS",
      });

    // Write-offs and the fee belong to a payment against bills; switching away clears them.
    values.writeOffs.forEach((writeOff, index) => {
      if (!writeOff.accountId)
        context.addIssue({
          code: "custom",
          path: ["writeOffs", index, "accountId"],
          message: "Choose a write-off account",
        });
    });

    if (
      values.settlementKind === "against" &&
      values.exposureSide === "payable" &&
      (values.feeAccountId || values.feeAmount) &&
      !(values.feeAccountId && isPositiveMoney(enteredPaise(values.feeAmount)))
    )
      context.addIssue({
        code: "custom",
        path: ["feeAmount"],
        message: "Choose an expense account and enter a positive fee",
      });
  });

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
} satisfies Record<string, FieldPath<Values>>;

const defaults = (today: string, partyId: string | null, paymentMethodId = ""): Values => ({
  partyId,
  partyName: "",
  amount: "",
  paymentMethodId,
  // The receipt's default and order, so both money screens open the same way.
  settlementKind: "advance",
  exposureSide: "payable",
  allocations: {},
  expenseAccountId: null,
  tdsSectionId: null,
  feeAccountId: null,
  feeAmount: "",
  writeOffs: [],
  reference: "",
  narration: "",
  documentDate: today,
});

export function PaymentForm({
  orgSlug,
  today,
  initialPartyId,
  onClose,
}: {
  orgSlug: string;
  today: string;
  initialPartyId?: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useZodForm(schema, { defaultValues: defaults(today, initialPartyId ?? null) });
  const settlementKind = useWatch({ control: form.control, name: "settlementKind" });
  const exposureSide = useWatch({ control: form.control, name: "exposureSide" });
  const partyId = useWatch({ control: form.control, name: "partyId" });
  const date = useWatch({ control: form.control, name: "documentDate" });
  const tdsSectionId = useWatch({ control: form.control, name: "tdsSectionId" });
  const writeOffFields = useFieldArray({ control: form.control, name: "writeOffs" });

  // Write-offs and the fee belong to settling bills; leaving that mode drops them.
  const clearPayableExtras = () => {
    writeOffFields.remove();
    form.setValue("feeAccountId", null);
    form.setValue("feeAmount", "");
  };

  const canSettle = useCan(orgSlug, { bill: ["read"], note: ["read"] });
  const parties = useQuery(partyPickerOptions(orgSlug));

  const accounts = useQuery(accountListOptions(orgSlug));
  const spendAccounts = accounts.data && postableAccounts(accounts.data, ["expense", "asset"]);
  const expenseAccounts = accounts.data && postableAccounts(accounts.data, ["expense"]);

  const items = useQuery(
    orpc.party.openItems.queryOptions({
      input:
        settlementKind === "against" && exposureSide === "payable" && partyId
          ? { orgSlug, partyId, side: "payable" }
          : skipToken,
    }),
  );

  const credits = useQuery(
    orpc.party.openCredits.queryOptions({
      input:
        settlementKind === "against" && exposureSide === "receivable" && partyId
          ? { orgSlug, partyId, side: "receivable", type: "creditNote" }
          : skipToken,
    }),
  );

  const openQuery = exposureSide === "payable" ? items : credits;

  const openRows: OpenDocument[] =
    exposureSide === "payable"
      ? (items.data?.rows.map((row) => ({
          ...row,
          label: "Bill",
          openPaise: row.outstandingPaise,
        })) ?? [])
      : (credits.data?.rows.map((row) => ({
          ...row,
          label: "Credit note",
          dueDate: null,
          openPaise: row.unappliedPaise,
        })) ?? []);

  const sections = useQuery(
    orpc.payment.tdsSections.queryOptions({
      input: settlementKind !== "against" ? { orgSlug, date } : skipToken,
    }),
  );

  const section = sections.data?.find((item) => item.id === tdsSectionId);

  useEffect(() => {
    if (!initialPartyId || !parties.data) return;
    const selected = parties.data.find((party) => party.id === initialPartyId);

    if (selected && form.getValues("partyId") === initialPartyId)
      form.setValue("partyName", selected.name);
  }, [initialPartyId, parties.data, form]);

  const post = useMutation(
    orpc.payment.post.mutationOptions({
      onSuccess: async () => {
        await invalidateCashState(queryClient, orgSlug);
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

            if (
              [
                "ALLOCATION_TARGET_INVALID",
                "ALLOCATION_SOURCE_INVALID",
                "ALLOCATION_EXCEEDS_OUTSTANDING",
                "ALLOCATION_EXCEEDS_SOURCE",
              ].includes(errorReason(error) ?? "")
            )
              await openQuery.refetch();
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

    if (values.settlementKind === "direct") {
      if (!values.expenseAccountId) return;
      post.mutate({
        ...common,
        settlementKind: "direct",
        partyId: values.partyId ?? undefined,
        expenseAccountId: values.expenseAccountId,
        tdsSectionId: values.tdsSectionId ?? undefined,
      });

      return;
    }

    if (!values.partyId) return;

    if (values.settlementKind === "advance") {
      post.mutate({
        ...common,
        settlementKind: "advance",
        partyId: values.partyId,
        tdsSectionId: values.tdsSectionId ?? undefined,
      });

      return;
    }

    if (!openQuery.isSuccess || openQuery.isFetching) {
      form.setError("allocations", { message: "Wait for the open documents to load" });

      return;
    }

    const { selected, allocatedPaise, rowErrors, tableError } = checkAllocations(
      values.allocations,
      openRows,
    );

    if (reportRowErrors(form.setError, rowErrors)) return;

    const paidPaise = parseMoney(values.amount);

    const writeOffs = values.writeOffs.map(({ accountId, amount }) => ({
      accountId: accountId!,
      amount,
    }));

    // A refund pays out exactly its credit notes; write-offs make a bill payment settle in full.
    const capacityPaise =
      paidPaise + writeOffs.reduce((total, { amount }) => total + parseMoney(amount), ZERO_MONEY);

    const allocationError =
      tableError ??
      (values.exposureSide === "receivable"
        ? allocatedPaise !== paidPaise
          ? "Refund amount must equal the allocated credit notes"
          : undefined
        : allocatedPaise > capacityPaise
          ? "Allocated amount cannot exceed the payment"
          : writeOffs.length > 0 && allocatedPaise !== capacityPaise
            ? "Allocate the full payment including write-offs"
            : undefined);

    if (allocationError) {
      form.setError("allocations", { message: allocationError });

      return;
    }

    if (values.exposureSide === "receivable") {
      post.mutate({
        ...common,
        settlementKind: "against",
        exposureSide: "receivable",
        partyId: values.partyId,
        allocations: selected.map(({ id, amount }) => ({ creditNoteId: id, amount })),
      });

      return;
    }

    const payableInput: Extract<Parameters<typeof post.mutate>[0], { exposureSide: "payable" }> = {
      ...common,
      settlementKind: "against",
      exposureSide: "payable",
      partyId: values.partyId,
      allocations: selected.map(({ id, amount }) => ({ billId: id, amount })),
    };

    if (writeOffs.length) payableInput.writeOffs = writeOffs;

    if (values.feeAccountId)
      payableInput.fee = { accountId: values.feeAccountId, amount: values.feeAmount };

    post.mutate(payableInput);
  });

  if (post.data)
    return (
      <PostedView
        number={post.data.number}
        onDone={onClose}
        onNext={() => {
          const { documentDate, paymentMethodId, partyId, partyName } = form.getValues();
          form.reset(
            { ...defaults(documentDate, partyId, paymentMethodId), partyName },
            { keepSubmitCount: true },
          );
          post.reset();
        }}
      />
    );

  const accountField = (
    name: "expenseAccountId" | "feeAccountId",
    label: string,
    choices: typeof accounts.data,
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
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
              aria-invalid={fieldState.invalid}
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
        pending={post.isPending}
        onSubmit={(event) => void submit(event)}
        footer={
          <PostBar onClose={onClose} closeLabel="Close">
            <Button type="submit">
              {post.isPending ? "Posting…" : post.isError ? "Post again" : "Post"}
              <Kbd>⌘↵</Kbd>
            </Button>
          </PostBar>
        }
      >
        <DocumentPartyField
          orgSlug={orgSlug}
          label={`Party${settlementKind === "direct" ? " (optional)" : ""}`}
          clearable={settlementKind === "direct"}
          onPartyChange={() => form.setValue("allocations", {})}
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
                  value={[field.value]}
                  onValueChange={(next) => {
                    if (next[0] === "direct" || next[0] === "advance" || next[0] === "against") {
                      if (next[0] !== "against") clearPayableExtras();
                      field.onChange(next[0]);
                    }
                  }}
                  spacing={1}
                  variant="outline"
                  aria-label="Settlement kind"
                >
                  <ToggleGroupItem value="advance">Advance</ToggleGroupItem>
                  {canSettle ? (
                    <ToggleGroupItem value="against">Against open items</ToggleGroupItem>
                  ) : null}
                  <ToggleGroupItem value="direct">Direct</ToggleGroupItem>
                </ToggleGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {settlementKind === "direct"
          ? accountField("expenseAccountId", "Expense or asset account", spendAccounts)
          : null}
        {settlementKind === "against" ? (
          <FormField
            control={form.control}
            name="exposureSide"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Pay against</FormLabel>
                <FormControl>
                  <ToggleGroup
                    value={[field.value]}
                    onValueChange={(next) => {
                      if (next[0] === "payable" || next[0] === "receivable") {
                        if (next[0] === "receivable") clearPayableExtras();
                        field.onChange(next[0]);
                        form.setValue("allocations", {});
                      }
                    }}
                    spacing={1}
                    variant="outline"
                    aria-label="Pay against"
                  >
                    <ToggleGroupItem value="payable">Bills</ToggleGroupItem>
                    <ToggleGroupItem value="receivable">Refund credit notes</ToggleGroupItem>
                  </ToggleGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}
        {settlementKind === "against" && partyId ? (
          <AllocationTable
            title={exposureSide === "payable" ? "Open bills" : "Unapplied credit notes"}
            openHeading={exposureSide === "payable" ? "Outstanding" : "Unapplied"}
            query={openQuery}
            rows={openRows}
            adjustmentsName={exposureSide === "payable" ? "writeOffs" : null}
            advanceRemainder={exposureSide === "payable"}
          />
        ) : null}
        {settlementKind === "against" && exposureSide === "payable" ? (
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
                      <Input
                        {...field}
                        inputMode="decimal"
                        placeholder="0.00"
                        className="tabular-nums"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </>
        ) : null}
        {settlementKind !== "against" ? (
          <FormField
            control={form.control}
            name="tdsSectionId"
            render={({ field, fieldState }) => (
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
                    aria-invalid={fieldState.invalid}
                  />
                </FormControl>
                <FormMessage />
                {section ? (
                  <p className="text-muted-foreground">
                    Section rate: {(section.rateBasisPoints / 100).toFixed(2)}% · Party PAN required
                  </p>
                ) : null}
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
