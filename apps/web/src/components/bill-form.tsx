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
import { Textarea } from "@accly/ui/components/textarea";
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useState } from "react";
import { useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { OptionField, STATE_OPTIONS } from "@/components/option-field";
import { DocumentForm, PostBar } from "@/components/document-form";
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
import { tdsSectionsOptions } from "@/lib/payments";
import { settingsOptions } from "@/lib/settings";
import { applyOrpcFieldError, handleWriteError, type ServerFields } from "@/lib/orpc-error";

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
      context.addIssue({ code: "custom", path: ["partyId"], message: "Choose a party" });

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
  BILL_NUMBER_TAKEN: "reference",
  BILL_TDS_EXCEEDS_TOTAL: "tdsSectionId",
} satisfies ServerFields<BillFormValues>;

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
export function BillTdsRows({ bill }: { bill: Pick<BillDetail, "netPaise" | "tds"> }) {
  return bill.tds ? (
    <>
      <DetailRow label={`TDS · ${bill.tds.sectionCode}`}>
        {formatMoney(bill.tds.amountPaise)}
      </DetailRow>
      <DetailRow label="Payable after TDS">{formatMoney(bill.netPaise)}</DetailRow>
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
  const settings = useSuspenseQuery(settingsOptions(orgSlug)).data;
  const registered = Boolean(settings.gstin);

  const form = useZodForm(billSchema, {
    defaultValues: defaults(today, settings.stateCode, draft),
  });

  const watchedPartyId = useWatch({ control: form.control, name: "partyId" });
  const watchedDate = useWatch({ control: form.control, name: "documentDate" });
  const tdsSectionId = useWatch({ control: form.control, name: "tdsSectionId" });
  // Date-scoped pickers wait for a complete date rather than query a half-typed one.
  const documentDate = z.iso.date().safeParse(watchedDate).success ? watchedDate : undefined;

  const sections = useQuery({
    ...tdsSectionsOptions(orgSlug, documentDate),
    enabled: canReadPayment && documentDate !== undefined,
  });

  const tdsAdvances = useQuery(
    orpc.party.openCredits.queryOptions({
      input:
        canReadPayment && watchedPartyId && tdsSectionId
          ? {
              orgSlug,
              partyId: watchedPartyId,
              side: "payable",
              types: ["payment"],
              tdsOnly: true,
              limit: 1,
            }
          : skipToken,
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
      onSuccess: async ({ id, number }) => {
        await invalidateSettlement();

        // A posted draft goes on to its record; a new bill clears for the next one.
        if (draft) {
          toast.success(`Bill ${number} posted`);
          onPosted(id);

          return;
        }

        toast.success(`Bill ${number} posted`, {
          action: { label: "Open", onClick: () => onPosted(id) },
        });
        form.reset(defaults(form.getValues("documentDate"), settings.stateCode), {
          keepSubmitCount: true,
        });
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

  return (
    <Form {...form}>
      <DocumentForm
        // Each post remounts the fields, so the next entry starts on the Party field.
        key={post.data?.id}
        pending={save.isPending || post.isPending}
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
        <DocumentPartyField orgSlug={orgSlug} label="Party" role="vendor" />
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
        {canReadPayment ? (
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
                    getKey={(section) => section.id}
                    getLabel={(section) => `${section.code} · ${section.description}`}
                    getCode={(section) => section.code}
                    value={sections.data?.find((section) => section.id === field.value) ?? null}
                    onSelect={(section) => field.onChange(section?.id ?? "")}
                    clearable
                    placeholder="Choose a TDS section"
                    inputRef={field.ref}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}
        {tdsSectionId && tdsAdvances.data?.rows.length ? (
          <p role="status" className="text-muted-foreground">
            You already deducted TDS when you paid this supplier an advance. Make sure you
            don&apos;t deduct it twice.
          </p>
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
        {draft ? (
          <section className="grid gap-2 border-y border-border py-3">
            <h3 className="text-muted-foreground">Saved totals</h3>
            <DocumentTotals document={draft}>
              <BillTdsRows bill={draft} />
            </DocumentTotals>
          </section>
        ) : null}
      </DocumentForm>
    </Form>
  );
}
