import { NON_NEGATIVE_MONEY_PATTERN, ZERO_MONEY, formatDecimal } from "@accly/api/core/money";
import { indianStateCode } from "@accly/api/lib/schemas";
import type { AppRouterClient } from "@accly/api/routers/index";
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
import { ToggleGroup, ToggleGroupItem } from "@accly/ui/components/toggle-group";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useWatch, type FieldPath } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ReferenceNarrationFields } from "@/components/reference-narration-fields";
import { OptionField, STATE_OPTIONS } from "@/components/option-field";
import { DocumentForm, PostBar, PostedView } from "@/components/document-form";
import { DocumentTotals } from "@/components/invoice-summary";
import { InvoiceLines, blankLine, lineSchema } from "@/components/invoice-lines";
import { DocumentPartyField } from "@/components/party-link-field";
import { PaymentMethodField } from "@/components/payment-method-field";
import { useZodForm } from "@/hooks/use-zod-form";
import {
  invalidateCashState,
  invalidateInvoiceDrafts,
  invalidateSettlementState,
} from "@/lib/domain-invalidation";
import type { InvoiceDetail } from "@/lib/invoices";
import { useCan } from "@/lib/membership";
import { orpc } from "@/lib/orpc";
import { applyOrpcFieldError, errorMessage, handleWriteError } from "@/lib/orpc-error";
import type { PartyOption } from "@/lib/parties";

const invoiceSchema = z
  .object({
    partyId: z.string().nullable(),
    partyName: z.string(),
    documentDate: z.iso.date(),
    dueDate: z.iso.date(),
    placeOfSupplyStateCode: indianStateCode,
    reference: z.string().trim().max(120, "Reference must be 120 characters or fewer"),
    narration: z.string().trim().max(500, "Narration must be 500 characters or fewer"),
    discount: z.union([
      z.literal(""),
      z.string().regex(NON_NEGATIVE_MONEY_PATTERN, "Enter a valid discount"),
    ]),
    paidNow: z.boolean(),
    paymentMethodId: z.string(),
    lines: z.array(lineSchema).min(1, "Add at least one line").max(100),
  })
  .superRefine((invoice, context) => {
    if (!invoice.partyId)
      context.addIssue({ code: "custom", path: ["partyId"], message: "Choose a party" });

    if (invoice.dueDate && invoice.dueDate < invoice.documentDate) {
      context.addIssue({
        code: "custom",
        path: ["dueDate"],
        message: "Due date cannot be before the invoice date",
      });
    }

    if (invoice.paidNow && !invoice.paymentMethodId) {
      context.addIssue({
        code: "custom",
        path: ["paymentMethodId"],
        message: "Choose a payment method",
      });
    }
  });

type InvoiceFormValues = z.input<typeof invoiceSchema>;

type InvoiceApiLine = Parameters<AppRouterClient["invoice"]["saveDraft"]>[0]["lines"][number];

const SERVER_FIELDS = {
  LOCKED: "documentDate",
  PARTY_INVALID: "partyId",
  DUE_DATE_BEFORE_DOCUMENT: "dueDate",
  ITEM_INVALID: "lines",
  TAX_RATE_MISSING: "lines",
  INVOICE_ZERO_TOTAL: "lines",
  DISCOUNT_EXCEEDS_SUBTOTAL: "discount",
  PAYMENT_METHOD_INVALID: "paymentMethodId",
} satisfies Record<string, FieldPath<InvoiceFormValues>>;

function defaults(documentDate: string, draft?: InvoiceDetail): InvoiceFormValues {
  if (!draft) {
    return {
      partyId: null,
      partyName: "",
      documentDate,
      dueDate: documentDate,
      placeOfSupplyStateCode: "",
      reference: "",
      narration: "",
      discount: "",
      paidNow: false,
      paymentMethodId: "",
      lines: [blankLine()],
    };
  }

  return {
    partyId: draft.partyId,
    partyName: draft.partyName ?? "",
    documentDate: draft.documentDate,
    dueDate: draft.dueDate ?? draft.documentDate,
    placeOfSupplyStateCode: draft.placeOfSupplyStateCode ?? "",
    reference: draft.reference ?? "",
    narration: draft.narration ?? "",
    discount: draft.discountPaise === ZERO_MONEY ? "" : formatDecimal(draft.discountPaise),
    paidNow: false,
    paymentMethodId: "",
    lines: draft.lines.map((line) => ({
      itemId: line.itemId,
      quantity: String(line.quantity ?? 1),
      unitPrice: line.unitPricePaise === null ? "" : formatDecimal(line.unitPricePaise),
      description: line.description,
    })),
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
  const paidNow = useWatch({ control: form.control, name: "paidNow" });

  const documentDate = useWatch({ control: form.control, name: "documentDate" });

  // The Party's state is the usual place of supply, and only while the field is
  // still empty: a state the operator picked meanwhile outranks this default.
  const defaultPlaceOfSupply = (partyId: string) =>
    queryClient.fetchQuery(orpc.party.get.queryOptions({ input: { orgSlug, partyId } })).then(
      (party) => {
        // A later pick wins over a slower read, and a state chosen meanwhile stays.
        if (form.getValues("partyId") !== partyId) return;

        if (form.getValues("placeOfSupplyStateCode") !== "") return;

        form.setValue("placeOfSupplyStateCode", party.stateCode, {
          shouldDirty: true,
          shouldValidate: true,
        });
      },
      (error) => toast.error(errorMessage(error, "Could not load the party's state")),
    );

  const partyChanged = (party: PartyOption | null) => {
    form.setValue("placeOfSupplyStateCode", "");

    if (party) void defaultPlaceOfSupply(party.id);
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
      reference: values.reference || undefined,
      narration: values.narration || undefined,
      discount: values.discount || undefined,
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
      onSuccess: async ({ id, receipt }) => {
        await (receipt ? invalidateCashState(queryClient, orgSlug) : invalidateSettlement());
        toast.success("Invoice posted");

        // A posted draft goes on to its record; a new invoice stays for Post and next.
        if (draft) onPosted(id);
      },
      // Retrying a new invoice could post it twice; a draft's retry is refused by its version.
      onError: (error) =>
        onMutationError(
          error,
          "Could not post the invoice",
          () =>
            canSettle && form.getValues("paidNow")
              ? invalidateCashState(queryClient, orgSlug)
              : invalidateSettlement(),
          !!draft,
        ),
    }),
  );

  const saveDraft = form.handleSubmit((values) => {
    const input = invoiceInput(values);

    if (input) save.mutate(input);
  });

  const submit = form.handleSubmit((values) => {
    const input = invoiceInput(values);

    if (input)
      post.mutate({
        ...input,
        settle:
          canSettle && values.paidNow ? { paymentMethodId: values.paymentMethodId } : undefined,
      });
  });

  const pending = save.isPending || post.isPending;

  const posted = post.data;

  if (posted) {
    return (
      <PostedView
        number={posted.number}
        onDone={() => onPosted(posted.id)}
        onNext={() => {
          form.reset(defaults(form.getValues("documentDate")), { keepSubmitCount: true });
          post.reset();
          dueDateEdited.current = false;
        }}
      />
    );
  }

  return (
    <Form {...form}>
      <DocumentForm
        pending={pending}
        onSubmit={(event) => {
          if (canPost) void submit(event);
        }}
        footer={
          <PostBar onClose={onClose} closeLabel="Close">
            {canSave ? (
              <Button type="button" variant="outline" onClick={() => void saveDraft()}>
                {save.isPending ? "Saving…" : "Save draft"}
              </Button>
            ) : null}
            {canPost ? (
              <Button type="submit">
                {post.isPending ? "Posting…" : post.isError ? "Post again" : "Post"}
                <Kbd>⌘↵</Kbd>
              </Button>
            ) : null}
          </PostBar>
        }
      >
        <div className="grid gap-3 md:grid-cols-2">
          <DocumentPartyField
            orgSlug={orgSlug}
            label="Party"
            role="customer"
            onPartyChange={partyChanged}
          />

          <div className="grid grid-cols-2 gap-3">
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
            render={({ field, fieldState }) => (
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
                    aria-invalid={fieldState.invalid}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <RegisteredFormField
            name="discount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Discount</FormLabel>
                <FormControl>
                  <Input
                    {...field}
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

          {canSettle ? (
            <section className="grid gap-3 md:col-span-2 md:grid-cols-2 md:items-end">
              <FormField
                control={form.control}
                name="paidNow"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Counter sale</FormLabel>
                    <FormControl>
                      <ToggleGroup
                        value={field.value ? ["paid"] : ["later"]}
                        onValueChange={(next) => {
                          if (next[0] === "paid" || next[0] === "later")
                            field.onChange(next[0] === "paid");
                        }}
                        spacing={1}
                        variant="outline"
                        aria-label="Payment timing"
                      >
                        <ToggleGroupItem value="later">Pay later</ToggleGroupItem>
                        <ToggleGroupItem value="paid">Paid now</ToggleGroupItem>
                      </ToggleGroup>
                    </FormControl>
                  </FormItem>
                )}
              />
              {paidNow ? <PaymentMethodField orgSlug={orgSlug} /> : null}
            </section>
          ) : null}
        </div>

        <InvoiceLines orgSlug={orgSlug} />

        <section className="grid gap-2 border-y border-border py-3">
          <h3 className="text-muted-foreground">Saved totals</h3>
          {draft ? (
            <DocumentTotals document={draft} />
          ) : (
            <p className="text-muted-foreground">
              Tax, round-off and the total are calculated when the draft is saved or the invoice is
              posted.
            </p>
          )}
        </section>

        <ReferenceNarrationFields />
      </DocumentForm>
    </Form>
  );
}

type InvoiceFormProps = {
  orgSlug: string;
  today: string;
  /** The draft being edited. Its totals stay live; its fields and token are read once. */
  draft?: InvoiceDetail;
  onClose: () => void;
  /** A new invoice's first save, so the caller can open the draft's own editor. */
  onSaved?: (draftId: string) => void;
  onPosted: (invoiceId: string) => void;
};
