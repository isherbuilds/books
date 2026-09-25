import { formatDecimal, formatMoney } from "@accly/api/core/money";
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
import { Textarea } from "@accly/ui/components/textarea";
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useState } from "react";
import { useWatch, type FieldPath } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { OptionField, STATE_OPTIONS } from "@/components/option-field";
import { DocumentForm, PostBar, PostedView } from "@/components/document-form";
import { BillLines, blankLine, lineSchema } from "@/components/bill-lines";
import { DetailRow } from "@/components/detail-row";
import { DocumentTotals } from "@/components/invoice-summary";
import { LinkField } from "@/components/link-field";
import { DocumentPartyField } from "@/components/party-link-field";
import { useZodForm } from "@/hooks/use-zod-form";
import type { BillDetail } from "@/lib/bills";
import { invalidateBillDrafts, invalidateSettlementState } from "@/lib/domain-invalidation";
import { useCan } from "@/lib/membership";
import { orpc } from "@/lib/orpc";
import { applyOrpcFieldError, handleWriteError } from "@/lib/orpc-error";

type BillApiLine = Parameters<AppRouterClient["bill"]["saveDraft"]>[0]["lines"][number];

const billSchema = z
  .object({
    partyId: z.string().nullable(),
    partyName: z.string(),
    reference: z.string().trim().max(40, "Supplier invoice number must be 40 characters or fewer"),
    documentDate: z.iso.date(),
    dueDate: z
      .string()
      .refine((value) => !value || z.iso.date().safeParse(value).success, "Enter a valid due date"),
    placeOfSupplyStateCode: indianStateCode,
    tdsSectionId: z.string(),
    narration: z.string().trim().max(500),
    lines: z.array(lineSchema).min(1, "Add at least one line").max(100),
  })
  .superRefine((bill, context) => {
    if (!bill.partyId)
      context.addIssue({ code: "custom", path: ["partyId"], message: "Choose a supplier" });

    if (bill.dueDate && bill.dueDate < bill.documentDate) {
      context.addIssue({
        code: "custom",
        path: ["dueDate"],
        message: "Due date cannot be before the bill date",
      });
    }
  });

type BillFormValues = z.input<typeof billSchema>;

const SERVER_FIELDS = {
  LOCKED: "documentDate",
  PARTY_INVALID: "partyId",
  PARTY_STATE_REQUIRED: "partyId",
  DUE_DATE_BEFORE_DOCUMENT: "dueDate",
  ACCOUNT_INVALID: "lines",
  TAX_CODE_INVALID: "lines",
  TDS_SECTION_INVALID: "tdsSectionId",
  TDS_PAN_REQUIRED: "partyId",
  BILL_ZERO_TOTAL: "lines",
  BILL_TDS_EXCEEDS_TOTAL: "tdsSectionId",
} satisfies Record<string, FieldPath<BillFormValues>>;

// Place of supply starts at the organization's own state.
function defaults(today: string, stateCode: string, draft?: BillDetail): BillFormValues {
  if (!draft)
    return {
      partyId: null,
      partyName: "",
      reference: "",
      documentDate: today,
      dueDate: "",
      placeOfSupplyStateCode: stateCode,
      tdsSectionId: "",
      narration: "",
      lines: [blankLine()],
    };

  return {
    partyId: draft.partyId,
    partyName: draft.partyName ?? "",
    reference: draft.reference ?? "",
    documentDate: draft.documentDate,
    dueDate: draft.dueDate ?? "",
    placeOfSupplyStateCode: draft.placeOfSupplyStateCode ?? stateCode,
    tdsSectionId: draft.tds?.tdsSectionId ?? "",
    narration: draft.narration ?? "",
    lines: draft.lines.map((line) => ({
      accountId: line.accountId ?? "",
      description: line.description,
      hsnSac: line.hsnSac ?? "",
      amount: formatDecimal(line.amountPaise),
      taxCode: line.taxCode ?? "",
      itcEligible: line.itcEligible ?? false,
    })),
  };
}

/** A Bill's TDS and what remains payable, below its totals. */
export function BillTdsRows({ bill }: { bill: Pick<BillDetail, "totalPaise" | "tds"> }) {
  return bill.tds ? (
    <>
      <DetailRow label={`TDS · ${bill.tds.sectionCode}`}>
        {formatMoney(bill.tds.amountPaise)}
      </DetailRow>
      <DetailRow label="Payable after TDS">
        {formatMoney(bill.totalPaise - bill.tds.amountPaise)}
      </DetailRow>
    </>
  ) : null;
}

export function BillForm({
  orgSlug,
  today,
  draft,
  onClose,
  onSaved,
  onPosted,
}: {
  orgSlug: string;
  today: string;
  draft?: BillDetail;
  onClose: () => void;
  onSaved?: (draftId: string) => void;
  onPosted: (billId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [draftToken, setDraftToken] = useState(draft && { id: draft.id, version: draft.version });
  const canSave = useCan(orgSlug, { bill: ["create"] });
  const canPost = useCan(orgSlug, { bill: ["post"] });
  const canReadPayment = useCan(orgSlug, { payment: ["read"] });
  // The route loader primes settings, so GST registration is known before any save.
  const settings = useSuspenseQuery(orpc.settings.get.queryOptions({ input: { orgSlug } })).data;
  const registered = Boolean(settings.gstin);

  const form = useZodForm(billSchema, {
    defaultValues: defaults(today, settings.stateCode, draft),
  });

  const watchedDate = useWatch({ control: form.control, name: "documentDate" });
  // Date-scoped pickers wait for a complete date rather than query a half-typed one.
  const documentDate = z.iso.date().safeParse(watchedDate).success ? watchedDate : undefined;

  const sections = useQuery(
    orpc.payment.tdsSections.queryOptions({
      input: canReadPayment && documentDate ? { orgSlug, date: documentDate } : skipToken,
    }),
  );

  const invalidateDrafts = () => invalidateBillDrafts(queryClient, orgSlug);
  const invalidateSettlement = () => invalidateSettlementState(queryClient, orgSlug);

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
        : "The result is uncertain. Check the bill list before entering it again.",
      refuse: () => applyOrpcFieldError(form, error, SERVER_FIELDS, fallback),
    });

  const save = useMutation(
    orpc.bill.saveDraft.mutationOptions({
      onSuccess: async (saved) => {
        setDraftToken(saved);
        await invalidateDrafts();
        toast.success("Draft saved");
        onSaved?.(saved.id);
      },
      onError: (error) =>
        onMutationError(error, "Could not save the bill draft", invalidateDrafts, !!draftToken),
    }),
  );

  const post = useMutation(
    orpc.bill.post.mutationOptions({
      onSuccess: async ({ id }) => {
        await invalidateSettlement();
        toast.success("Bill posted");

        if (draft) onPosted(id);
      },
      onError: (error) =>
        onMutationError(error, "Could not post the bill", invalidateSettlement, !!draftToken),
    }),
  );

  const input = (
    values: BillFormValues,
  ): Parameters<AppRouterClient["bill"]["saveDraft"]>[0] | null => {
    if (!values.partyId || !values.placeOfSupplyStateCode) return null;

    const lines: BillApiLine[] = values.lines.map((line) => ({
      accountId: line.accountId,
      description: line.description,
      amount: line.amount,
      taxCode: line.taxCode || undefined,
      hsnSac: line.hsnSac || undefined,
      itcEligible: registered && line.itcEligible,
    }));

    return {
      orgSlug,
      partyId: values.partyId,
      reference: values.reference || undefined,
      documentDate: values.documentDate,
      dueDate: values.dueDate || undefined,
      placeOfSupplyStateCode: values.placeOfSupplyStateCode,
      tdsSectionId: values.tdsSectionId || undefined,
      narration: values.narration || undefined,
      lines,
      draft: draftToken,
    };
  };

  const saveDraft = form.handleSubmit((values) => {
    const data = input(values);

    if (data) save.mutate(data);
  });

  const submit = form.handleSubmit((values) => {
    if (!values.reference) {
      form.setError(
        "reference",
        { message: "Enter the supplier invoice number before posting" },
        { shouldFocus: true },
      );

      return;
    }

    const data = input(values);

    if (data) post.mutate(data);
  });

  const posted = post.data;

  if (posted)
    return (
      <PostedView
        number={posted.number}
        onDone={() => onPosted(posted.id)}
        onNext={() => {
          form.reset(defaults(form.getValues("documentDate"), settings.stateCode), {
            keepSubmitCount: true,
          });
          post.reset();
        }}
      />
    );

  return (
    <Form {...form}>
      <DocumentForm
        pending={save.isPending || post.isPending}
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
        <DocumentPartyField orgSlug={orgSlug} label="Supplier" role="vendor" />
        <RegisteredFormField
          name="reference"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Supplier invoice number</FormLabel>
              <FormControl>
                <Input {...field} maxLength={40} autoComplete="off" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <RegisteredFormField
            name="documentDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Supplier invoice date</FormLabel>
                <FormControl>
                  <Input {...field} required type="date" />
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
                  <Input {...field} type="date" min={documentDate} />
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
        {canReadPayment ? (
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
                    getKey={(section) => section.id}
                    getLabel={(section) => `${section.code} · ${section.description}`}
                    getCode={(section) => section.code}
                    value={sections.data?.find((section) => section.id === field.value) ?? null}
                    onSelect={(section) => field.onChange(section?.id ?? "")}
                    clearable
                    placeholder="Choose a TDS section"
                    inputRef={field.ref}
                    aria-invalid={fieldState.invalid}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}
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
        <BillLines orgSlug={orgSlug} registered={registered} documentDate={documentDate} />
        <section className="grid gap-2 border-y border-border py-3">
          <h3 className="text-muted-foreground">Saved totals</h3>
          {draft ? (
            <DocumentTotals document={draft}>
              <BillTdsRows bill={draft} />
            </DocumentTotals>
          ) : (
            <p className="text-muted-foreground">
              Tax, TDS, round-off and the total are calculated when the draft is saved or the bill
              is posted.
            </p>
          )}
        </section>
      </DocumentForm>
    </Form>
  );
}
