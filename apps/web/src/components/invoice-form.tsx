import {
  NON_NEGATIVE_MONEY_PATTERN,
  PERCENT_PATTERN,
  ZERO_MONEY,
  formatDecimal,
  formatMoney,
  parseBasisPoints,
} from "@accly/api/core/money";
import { stateLabel } from "@accly/api/lib/indian-states";
import { indianStateCode } from "@accly/api/lib/schemas";
import type { AppRouterClient } from "@accly/api/routers/index";
import type { PartyRecord } from "@accly/api/routers/party";
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
import { Checkbox } from "@accly/ui/components/checkbox";
import { Input } from "@accly/ui/components/input";
import { Label } from "@accly/ui/components/label";
import { Textarea } from "@accly/ui/components/textarea";
import { ToggleGroup, ToggleGroupItem } from "@accly/ui/components/toggle-group";
import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { useWatch, type FieldPath } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ReferenceNarrationFields } from "@/components/reference-narration-fields";
import { OptionField, STATE_OPTIONS } from "@/components/option-field";
import { DocumentForm, PostBar } from "@/components/document-form";
import { InvoiceTotalsPanel } from "@/components/invoice-summary";
import {
  InvoiceLines,
  blankLine,
  lineAmountPaise,
  lineSchema,
  type InvoiceLineQuote,
} from "@/components/invoice-lines";
import {
  InvoicePayments,
  MAX_PAYMENTS,
  paymentLineSchema,
  receivedPaise,
} from "@/components/invoice-payments";
import { PartySheet } from "@/components/party-form";
import { DocumentPartyField } from "@/components/party-link-field";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useZodForm } from "@/hooks/use-zod-form";
import {
  invalidateCashState,
  invalidateInvoiceDrafts,
  invalidateSettlementState,
} from "@/lib/domain-invalidation";
import type { InvoiceDetail } from "@/lib/invoices";
import { useCan, useMembership } from "@/lib/membership";
import { orpc } from "@/lib/orpc";
import {
  applyOrpcFieldError,
  errorMessage,
  handleWriteError,
  type ServerFields,
} from "@/lib/orpc-error";
import { partyDetailOptions, type PartyOption } from "@/lib/parties";

const invoiceSchema = z
  .object({
    partyId: z.string().nullable(),
    partyName: z.string(),
    documentDate: z.iso.date(),
    dueDate: z.iso.date(),
    placeOfSupplyStateCode: indianStateCode,
    // Null prints no Ship to: the Party's address is then the address of delivery.
    shipTo: z
      .object({
        address: z
          .string()
          .trim()
          .min(1, "Enter the delivery address")
          .max(300, "Address must be 300 characters or fewer"),
        stateCode: indianStateCode,
      })
      .nullable(),
    reference: z.string().trim().max(120, "Reference must be 120 characters or fewer"),
    narration: z.string().trim().max(500, "Narration must be 500 characters or fewer"),
    // A bill discount in rupees or as a percentage of the subtotal (as Zoho's ₹/% switch).
    discountMode: z.enum(["amount", "percent"]),
    discount: z.string(),
    // Received now; none is a credit sale. Never saved with a draft.
    payments: z.array(paymentLineSchema).max(MAX_PAYMENTS),
    lines: z.array(lineSchema).min(1, "Add at least one line").max(100),
  })
  .superRefine((invoice, context) => {
    if (invoice.discount !== "" && !discountValid(invoice.discountMode, invoice.discount)) {
      context.addIssue({
        code: "custom",
        path: ["discount"],
        message:
          invoice.discountMode === "percent"
            ? "Enter a percentage above 0 and up to 100"
            : "Enter a valid discount",
      });
    }

    if (!invoice.partyId)
      context.addIssue({ code: "custom", path: ["partyId"], message: "Choose a party" });

    if (invoice.dueDate && invoice.dueDate < invoice.documentDate) {
      context.addIssue({
        code: "custom",
        path: ["dueDate"],
        message: "Due date cannot be before the invoice date",
      });
    }
  });

type InvoiceFormValues = z.input<typeof invoiceSchema>;

type DiscountMode = InvoiceFormValues["discountMode"];

// Everything a draft saves: all but the payment lines, which post only with the invoice.
const DRAFT_FIELDS = [
  "partyId",
  "documentDate",
  "dueDate",
  "placeOfSupplyStateCode",
  "shipTo",
  "reference",
  "narration",
  "discount",
  "lines",
] satisfies FieldPath<InvoiceFormValues>[];

function discountValid(mode: DiscountMode, value: string) {
  if (mode === "amount") return NON_NEGATIVE_MONEY_PATTERN.test(value);

  if (!PERCENT_PATTERN.test(value)) return false;

  const basisPoints = parseBasisPoints(value);

  return basisPoints > 0 && basisPoints <= 10_000;
}

/** The API's discount fields for the form's mode; an empty discount sends neither. */
function discountInput(mode: DiscountMode, value: string) {
  if (value === "") return {};

  return mode === "percent" ? { discountPercent: value } : { discount: value };
}

type InvoiceApiLine = Parameters<AppRouterClient["invoice"]["saveDraft"]>[0]["lines"][number];

const SERVER_FIELDS = {
  LOCKED: "documentDate",
  PARTY_INVALID: "partyId",
  DUE_DATE_BEFORE_DOCUMENT: "dueDate",
  ITEM_INVALID: "lines",
  ITEM_TAX_CODE_REQUIRED: "lines",
  TAX_RATE_MISSING: "lines",
  INVOICE_ZERO_TOTAL: "lines",
  DISCOUNT_EXCEEDS_SUBTOTAL: "discount",
  DISCOUNT_CONFLICT: "discount",
  PAYMENT_METHOD_INVALID: "payments",
  SETTLEMENT_EXCEEDS_TOTAL: "payments",
} satisfies ServerFields<InvoiceFormValues>;

function defaults(documentDate: string, draft?: InvoiceDetail): InvoiceFormValues {
  if (!draft) {
    return {
      partyId: null,
      partyName: "",
      documentDate,
      dueDate: documentDate,
      placeOfSupplyStateCode: "",
      shipTo: null,
      reference: "",
      narration: "",
      discountMode: "amount",
      discount: "",
      payments: [],
      lines: [blankLine()],
    };
  }

  return {
    partyId: draft.partyId,
    partyName: draft.partyName ?? "",
    documentDate: draft.documentDate,
    dueDate: draft.dueDate ?? draft.documentDate,
    placeOfSupplyStateCode: draft.placeOfSupplyStateCode ?? "",
    shipTo: draft.printSnapshot?.shipTo ?? null,
    reference: draft.reference ?? "",
    narration: draft.narration ?? "",
    ...draftDiscount(draft),
    payments: [],
    lines: draft.lines.map((line) => ({
      itemId: line.itemId,
      quantity: String(line.quantity ?? 1),
      unitPrice: line.unitPricePaise === null ? "" : formatDecimal(line.unitPricePaise),
      // The server stores the Item's name for a blank description; show it blank again.
      description: line.description === line.itemName ? "" : line.description,
    })),
  };
}

// A percentage discount reopens as the percentage it was entered as.
function draftDiscount(draft: InvoiceDetail): Pick<InvoiceFormValues, "discountMode" | "discount"> {
  const basisPoints = draft.printSnapshot?.discountBasisPoints;

  if (basisPoints !== undefined) {
    return { discountMode: "percent", discount: String(basisPoints / 100) };
  }

  return {
    discountMode: "amount",
    discount: draft.discountPaise === ZERO_MONEY ? "" : formatDecimal(draft.discountPaise),
  };
}

type QuoteInput = Parameters<AppRouterClient["invoice"]["quote"]>[0];

/**
 * What the totals are quoted from: the complete lines only, with the positions they
 * came from, or null until a party, a place of supply and one complete line exist.
 */
function quoteRequest(
  orgSlug: string,
  values: InvoiceFormValues,
): { input: QuoteInput; positions: number[] } | null {
  if (
    !values.partyId ||
    !indianStateCode.safeParse(values.placeOfSupplyStateCode).success ||
    !values.documentDate ||
    (values.discount !== "" && !discountValid(values.discountMode, values.discount))
  ) {
    return null;
  }

  const positions: number[] = [];
  const lines: QuoteInput["lines"] = [];

  values.lines.forEach((line, index) => {
    if (!line.itemId || lineAmountPaise(line) === null) return;

    positions.push(index);
    lines.push({
      kind: "item",
      itemId: line.itemId,
      quantity: Number(line.quantity),
      unitPrice: line.unitPrice,
    });
  });

  if (lines.length === 0) return null;

  return {
    input: {
      orgSlug,
      partyId: values.partyId,
      documentDate: values.documentDate,
      placeOfSupplyStateCode: values.placeOfSupplyStateCode,
      ...discountInput(values.discountMode, values.discount),
      lines,
    },
    positions,
  };
}

/** Design §10: a line grid is a Page, so the new-invoice and draft pages host this. */
export function InvoiceForm({
  orgSlug,
  today,
  draft,
  onClose,
  onSaved,
  onPosted,
}: InvoiceFormProps) {
  const queryClient = useQueryClient();
  const dueDateEdited = useRef(Boolean(draft?.dueDate));
  // The edit token moves only with this editor's own saves, so a refetch that
  // carries someone else's change leaves it behind and the next save is refused.
  const [draftToken, setDraftToken] = useState(draft && { id: draft.id, version: draft.version });
  const canSave = useCan(orgSlug, { invoice: ["create"] });
  const canPost = useCan(orgSlug, { invoice: ["post"] });
  const canSettle = useCan(orgSlug, { receipt: ["post"] });
  const form = useZodForm(invoiceSchema, { defaultValues: defaults(today, draft) });

  const organizationName = useMembership(
    orgSlug,
    (membership) => membership.organizations.find((org) => org.slug === orgSlug)?.name,
  );

  const partyId = useWatch({ control: form.control, name: "partyId" });
  const discountMode = useWatch({ control: form.control, name: "discountMode" });

  // Deep-compared, so a description, reference or payment keystroke re-renders nothing here.
  const quoteInputs = useWatch({
    control: form.control,
    compute: (values: InvoiceFormValues) => ({
      request: quoteRequest(orgSlug, values),
      // Only lines the quote can price, so Subtotal and Total cover the same lines.
      subtotalPaise: values.lines.reduce(
        (sum, line) => sum + ((line.itemId && lineAmountPaise(line)) || ZERO_MONEY),
        ZERO_MONEY,
      ),
    }),
  });

  const { subtotalPaise } = quoteInputs;
  const quoteRequestValue = quoteInputs.request;
  const debouncedRequest = useDebouncedValue(quoteRequestValue, 300);

  const quote = useQuery({
    ...orpc.invoice.quote.queryOptions({ input: debouncedRequest?.input ?? skipToken }),
    placeholderData: keepPreviousData,
    retry: false,
  });

  // With nothing to quote (a fresh or cleared form) the last quote no longer applies.
  const quoted = quoteRequestValue && debouncedRequest ? quote.data : undefined;

  // A quote for other inputs may be shown, dimmed, but never checked against or filled from.
  const stale =
    quote.isPlaceholderData ||
    quote.isFetching ||
    quote.isError ||
    quoteRequestValue !== debouncedRequest;

  const current = stale ? undefined : quoted;

  const lineQuotes: Array<InvoiceLineQuote | undefined> = [];

  if (current && debouncedRequest) {
    debouncedRequest.positions.forEach((position, index) => {
      lineQuotes[position] = current.lines[index];
    });
  }

  // Only the yes/no re-renders the form, not each keystroke in the address.
  const shipping = useWatch({
    control: form.control,
    name: "shipTo",
    compute: (shipTo) => shipTo !== null,
  });

  const shippingId = useId();

  const documentDate = useWatch({ control: form.control, name: "documentDate" });

  // One read of the chosen Party serves the Bill-to card and the state defaults.
  const party = useQuery(partyDetailOptions(orgSlug, partyId ?? undefined));

  // The Party's state is the usual place of supply. It fills only fields still empty,
  // so a state chosen meanwhile stays, and a later pick wins over a slower read.
  const defaultsFor = useRef<string | null>(null);

  useEffect(() => {
    if (!party.data || defaultsFor.current !== party.data.id) return;
    defaultsFor.current = null;

    if (form.getValues("shipTo.stateCode") === "") {
      form.setValue("shipTo.stateCode", party.data.stateCode);
    }

    if (form.getValues("placeOfSupplyStateCode") === "") {
      form.setValue("placeOfSupplyStateCode", party.data.stateCode, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }, [party.data, form]);

  const partyChanged = (picked: PartyOption | null) => {
    form.setValue("placeOfSupplyStateCode", "");
    defaultsFor.current = picked?.id ?? null;
  };

  const invoiceInput = (values: InvoiceFormValues) => {
    if (!values.partyId) return null;

    const apiLines = values.lines.flatMap((line): InvoiceApiLine[] =>
      line.itemId
        ? [
            {
              kind: "item",
              itemId: line.itemId,
              quantity: Number(line.quantity),
              unitPrice: line.unitPrice,
              description: line.description || undefined,
            },
          ]
        : [],
    );

    if (apiLines.length !== values.lines.length) return null;

    return {
      orgSlug,
      partyId: values.partyId,
      documentDate: values.documentDate,
      dueDate: values.dueDate,
      placeOfSupplyStateCode: values.placeOfSupplyStateCode,
      shipTo: values.shipTo ?? undefined,
      reference: values.reference || undefined,
      narration: values.narration || undefined,
      ...discountInput(values.discountMode, values.discount),
      lines: apiLines,
      draft: draftToken,
    };
  };

  // A CONFLICT means the loaded draft moved on, so the editor closes and the record
  // shows the current state; every other refusal goes to its field. `invalidate` is
  // the set of the write that failed, never a broader one. Only a write without a
  // version token can land twice, so only it treats a lost response as uncertain.
  const onMutationError = (
    error: unknown,
    fallback: string,
    invalidate: () => Promise<void>,
    versioned: boolean,
  ) =>
    handleWriteError(error, {
      settle: () => {
        onClose();

        return invalidate();
      },
      fallback,
      uncertain: versioned
        ? null
        : "The result is uncertain. Check the invoice list before entering it again.",
      refuse: () => applyOrpcFieldError(form, error, SERVER_FIELDS, fallback),
    });

  // A draft save moves invoice reads alone; posting moves settlement as well.
  const invalidateDrafts = () => invalidateInvoiceDrafts(queryClient, orgSlug);
  const invalidateSettlement = () => invalidateSettlementState(queryClient, orgSlug);

  const save = useMutation(
    orpc.invoice.saveDraft.mutationOptions({
      onSuccess: async (saved) => {
        setDraftToken(saved);
        await invalidateDrafts();
        toast.success("Draft saved");
        onSaved?.(saved.id);
      },
      // A first save that lost its response may have inserted the draft; an existing
      // draft's retry is refused by its version.
      onError: (error) =>
        onMutationError(error, "Could not save the invoice draft", invalidateDrafts, !!draftToken),
    }),
  );

  const post = useMutation(
    orpc.invoice.post.mutationOptions({
      onSuccess: async ({ id, number, receipts }, { settle }) => {
        await (receipts.length > 0
          ? invalidateCashState(queryClient, orgSlug)
          : invalidateSettlement());

        const received = settle ? receivedPaise(settle.payments) : ZERO_MONEY;

        const message =
          received > ZERO_MONEY
            ? `Invoice ${number} posted · ${formatMoney(received)} received`
            : `Invoice ${number} posted`;

        // A posted draft goes on to its record; a new invoice clears for the next one.
        if (draft) {
          toast.success(message);
          onPosted(id);

          return;
        }

        toast.success(message, {
          action: { label: "Open", onClick: () => onPosted(id) },
        });
        form.reset(defaults(form.getValues("documentDate")), { keepSubmitCount: true });
        dueDateEdited.current = false;
      },
      // Retrying a new invoice could post it twice; a draft's retry is refused by its version.
      onError: (error) =>
        onMutationError(
          error,
          "Could not post the invoice",
          () =>
            canSettle && form.getValues("payments").length > 0
              ? invalidateCashState(queryClient, orgSlug)
              : invalidateSettlement(),
          !!draft,
        ),
    }),
  );

  // Payments post only with the invoice, so an unfinished payment line never blocks a draft.
  const saveDraft = async () => {
    if (!(await form.trigger(DRAFT_FIELDS, { shouldFocus: true }))) return;

    const input = invoiceInput(form.getValues());

    if (input) save.mutate(input);
  };

  const submit = form.handleSubmit((values) => {
    const input = invoiceInput(values);

    if (!input) return;

    const payments = canSettle ? values.payments : [];

    // The server refuses it too; the latest quote lets the form say so at once.
    if (current && receivedPaise(payments) > current.totalPaise) {
      form.setError("payments", { message: "Received cannot exceed the invoice total" });

      return;
    }

    post.mutate({
      ...input,
      settle:
        payments.length > 0
          ? {
              payments: payments.map(({ paymentMethodId, amount, reference }) => ({
                paymentMethodId,
                amount,
                reference: reference || undefined,
              })),
            }
          : undefined,
    });
  });

  const pending = save.isPending || post.isPending;

  return (
    <Form {...form}>
      <DocumentForm
        // Each post remounts the fields, so the next entry starts on the Party field.
        key={post.data?.id}
        pending={pending}
        onSubmit={(event) => {
          if (canPost) void submit(event);
        }}
        footer={
          <PostBar onClose={onClose} post={canPost ? post : undefined}>
            {canSave ? (
              <Button type="button" variant="outline" onClick={() => void saveDraft()}>
                {save.isPending ? "Saving…" : "Save draft"}
              </Button>
            ) : null}
          </PostBar>
        }
      >
        {/* The editor is laid out as the invoice it prints: seller and number, the
            customer beside the dates, the lines, then notes beside the totals. */}
        <div className="grid gap-6">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <p className="text-xl font-medium">{organizationName}</p>
            <div className="sm:text-right">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Invoice
              </p>
              <p className="text-muted-foreground">Numbered when posted</p>
            </div>
          </header>

          <div className="grid gap-x-8 gap-y-3 md:grid-cols-[minmax(0,1fr)_15rem]">
            <section aria-label="Customer" className="grid content-start gap-3">
              <DocumentPartyField
                orgSlug={orgSlug}
                label="Bill to"
                role="customer"
                onPartyChange={partyChanged}
              />
              {party.data ? <BillToCard orgSlug={orgSlug} party={party.data} /> : null}
              {party.isError ? (
                <p role="alert" className="text-destructive">
                  {errorMessage(party.error, "Could not load the party's address")}
                </p>
              ) : null}

              <div className="flex items-center gap-2">
                <Checkbox
                  id={shippingId}
                  // Base UI puts `id` on its hidden input; the visible checkbox needs the name.
                  aria-labelledby={`${shippingId}-label`}
                  checked={shipping}
                  onCheckedChange={(checked) => {
                    form.clearErrors("shipTo");
                    form.setValue(
                      "shipTo",
                      checked
                        ? { address: "", stateCode: form.getValues("placeOfSupplyStateCode") }
                        : null,
                      { shouldDirty: true },
                    );
                  }}
                />
                <Label id={`${shippingId}-label`} htmlFor={shippingId}>
                  Ship to a different address
                </Label>
              </div>

              {shipping ? (
                <div className="grid gap-3">
                  <RegisteredFormField
                    name="shipTo.address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Ship to</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            required
                            maxLength={300}
                            rows={2}
                            placeholder="Consignee, street, city, PIN"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="shipTo.stateCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Ship to state</FormLabel>
                        <FormControl>
                          <OptionField
                            options={STATE_OPTIONS}
                            noun="states"
                            showCode
                            value={field.value}
                            onChange={field.onChange}
                            placeholder="Choose a state"
                            inputRef={field.ref}
                            required
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              ) : null}
            </section>

            <section aria-label="Invoice details" className="grid content-start gap-3">
              <div className="grid gap-3">
                <RegisteredFormField
                  name="documentDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Invoice date</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          required
                          type="date"
                          onChange={(event) => {
                            field.onChange(event);

                            if (!dueDateEdited.current) {
                              form.setValue("dueDate", event.currentTarget.value, {
                                shouldDirty: true,
                                shouldValidate: true,
                              });
                            }
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <RegisteredFormField
                  name="dueDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Due date</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          required
                          type="date"
                          min={documentDate}
                          onChange={(event) => {
                            dueDateEdited.current = true;
                            field.onChange(event);
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="placeOfSupplyStateCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Place of supply</FormLabel>
                    <FormControl>
                      <OptionField
                        options={STATE_OPTIONS}
                        noun="states"
                        showCode
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="Choose a state"
                        inputRef={field.ref}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </section>
          </div>

          <InvoiceLines orgSlug={orgSlug} quotes={lineQuotes} />

          <div className="grid gap-x-8 gap-y-6 border-t border-border pt-6 md:grid-cols-[minmax(0,1fr)_18rem] md:items-start">
            <div className="order-2 grid gap-3 md:order-1">
              <ReferenceNarrationFields />
            </div>
            <div className="order-1 md:order-2">
              <InvoiceTotalsPanel
                subtotalPaise={subtotalPaise}
                quote={quoted}
                stale={stale}
                error={
                  quoteRequestValue && quote.isError
                    ? errorMessage(quote.error, "Could not work out the totals")
                    : null
                }
                discount={
                  <div className="grid gap-1">
                    <div className="flex items-start gap-1">
                      <FormField
                        control={form.control}
                        name="discountMode"
                        render={({ field }) => (
                          <ToggleGroup
                            value={[field.value]}
                            onValueChange={(next) => {
                              if (next[0] === "amount" || next[0] === "percent") {
                                field.onChange(next[0]);
                                form.clearErrors("discount");
                              }
                            }}
                            variant="outline"
                            aria-label="Discount as"
                          >
                            <ToggleGroupItem value="amount" aria-label="Amount in rupees">
                              ₹
                            </ToggleGroupItem>
                            <ToggleGroupItem value="percent" aria-label="Percentage">
                              %
                            </ToggleGroupItem>
                          </ToggleGroup>
                        )}
                      />
                      <RegisteredFormField
                        name="discount"
                        render={({ field }) => (
                          <FormItem className="min-w-0 flex-1">
                            <FormLabel className="sr-only">Discount</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                inputMode="decimal"
                                autoComplete="off"
                                placeholder={discountMode === "percent" ? "0" : "0.00"}
                                className="text-right tabular-nums"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    {discountMode === "percent" && current && current.discountPaise > ZERO_MONEY ? (
                      <p className="text-right text-muted-foreground tabular-nums">
                        {formatMoney(current.discountPaise)}
                      </p>
                    ) : null}
                  </div>
                }
              >
                {canSettle ? (
                  <InvoicePayments
                    orgSlug={orgSlug}
                    totalPaise={current?.totalPaise ?? null}
                    stale={stale}
                  />
                ) : null}
              </InvoiceTotalsPanel>
            </div>
          </div>
        </div>
      </DocumentForm>
    </Form>
  );
}

/** The Party's printed identity, from its master; Edit corrects the master itself. */
function BillToCard({ orgSlug, party }: { orgSlug: string; party: PartyRecord }) {
  const canEdit = useCan(orgSlug, { party: ["update"] });
  const [editing, setEditing] = useState(false);

  const { address, city, pinCode, stateCode, gstin } = party;
  const cityLine = [city, pinCode].filter(Boolean).join(" ");

  return (
    <div className="grid gap-0.5 text-muted-foreground">
      {address ? <p className="whitespace-pre-line">{address}</p> : null}
      {cityLine ? <p>{cityLine}</p> : null}
      <p>{stateLabel(stateCode)}</p>
      <p className="font-mono text-foreground">{gstin ? `GSTIN ${gstin}` : "Unregistered"}</p>
      {canEdit ? (
        <>
          <button
            type="button"
            className="justify-self-start text-foreground underline-offset-4 hover:underline"
            onClick={() => setEditing(true)}
          >
            Edit party
          </button>
          <PartySheet
            orgSlug={orgSlug}
            party={party}
            open={editing}
            onClose={() => setEditing(false)}
            onSaved={() => setEditing(false)}
          />
        </>
      ) : null}
    </div>
  );
}

type InvoiceFormProps = {
  orgSlug: string;
  today: string;
  /** The draft being edited. Its fields and token are read once. */
  draft?: InvoiceDetail;
  onClose: () => void;
  /** A new invoice's first save, so the caller can open the draft's own editor. */
  onSaved?: (draftId: string) => void;
  onPosted: (invoiceId: string) => void;
};
