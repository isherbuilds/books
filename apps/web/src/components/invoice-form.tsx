import { NON_NEGATIVE_MONEY_PATTERN, formatDecimal } from "@accly/api/core/money";
import { INDIAN_STATES } from "@accly/api/lib/indian-states";
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
import { NativeSelect } from "@accly/ui/components/native-select";
import { Textarea } from "@accly/ui/components/textarea";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2Icon } from "lucide-react";
import { useRef, useState } from "react";
import {
  useFieldArray,
  useFormState,
  useWatch,
  type Control,
  type FieldPath,
  type UseFormReturn,
} from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { DocumentForm, LineGrid, PostBar, PostedView } from "@/components/document-form";
import { FormSheet } from "@/components/form-sheet";
import { InvoiceTotals } from "@/components/invoice-summary";
import { ItemSheet, type SavedItem } from "@/components/item-sheet";
import { LinkField } from "@/components/link-field";
import { PartyLinkField } from "@/components/party-link-field";
import { useZodForm } from "@/hooks/use-zod-form";
import { incomeAccountOptions } from "@/lib/accounts";
import { invalidateDocumentState } from "@/lib/domain-invalidation";
import type { InvoiceDetail } from "@/lib/invoices";
import { itemListOptions, type ItemListRow } from "@/lib/items";
import { useCan } from "@/lib/membership";
import { orpc } from "@/lib/orpc";
import { applyOrpcFieldError, errorMessage, hasErrorCode, isRefusal } from "@/lib/orpc-error";

const activeItems = (rows: ItemListRow[]) => rows.filter((item) => item.active);

const lineSchema = z
  .object({
    kind: z.enum(["item", "account"]),
    itemId: z.string().nullable(),
    accountId: z.string().nullable(),
    quantity: z.string(),
    unitPrice: z.string(),
    description: z.string().trim().max(200, "Description must be 200 characters or fewer"),
    amount: z.string(),
  })
  .superRefine((line, context) => {
    if (line.kind === "item") {
      if (!line.itemId)
        context.addIssue({ code: "custom", path: ["itemId"], message: "Choose an item" });

      if (!/^\d+$/.test(line.quantity) || Number(line.quantity) < 1) {
        context.addIssue({
          code: "custom",
          path: ["quantity"],
          message: "Quantity must be at least 1",
        });
      }

      if (!NON_NEGATIVE_MONEY_PATTERN.test(line.unitPrice)) {
        context.addIssue({ code: "custom", path: ["unitPrice"], message: "Enter a valid price" });
      }
    } else {
      if (!line.accountId) {
        context.addIssue({
          code: "custom",
          path: ["accountId"],
          message: "Choose an income account",
        });
      }

      if (!line.description) {
        context.addIssue({ code: "custom", path: ["description"], message: "Enter a description" });
      }

      if (!NON_NEGATIVE_MONEY_PATTERN.test(line.amount) || Number(line.amount) <= 0) {
        context.addIssue({
          code: "custom",
          path: ["amount"],
          message: "Amount must be greater than zero",
        });
      }
    }
  });

const invoiceSchema = z
  .object({
    partyId: z.string().nullable(),
    partyName: z.string(),
    documentDate: z.iso.date(),
    dueDate: z.iso.date(),
    placeOfSupplyStateCode: indianStateCode,
    reference: z.string().trim().max(120, "Reference must be 120 characters or fewer"),
    narration: z.string().trim().max(500, "Narration must be 500 characters or fewer"),
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
  });

type InvoiceFormValues = z.input<typeof invoiceSchema>;

type InvoiceFormReturn = UseFormReturn<InvoiceFormValues, unknown, z.output<typeof invoiceSchema>>;

type InvoiceApiLine = Parameters<AppRouterClient["invoice"]["saveDraft"]>[0]["lines"][number];

const SERVER_FIELDS = {
  PARTY_INVALID: "partyId",
  DUE_DATE_BEFORE_DOCUMENT: "dueDate",
  ITEM_INVALID: "lines",
  INCOME_ACCOUNT_INVALID: "lines",
  TAX_RATE_MISSING: "lines",
  TAXABLE_ACCOUNT_LINE: "lines",
  INVOICE_ZERO_TOTAL: "lines",
} satisfies Record<string, FieldPath<InvoiceFormValues>>;

const blankLine = (kind: InvoiceFormValues["lines"][number]["kind"]) => ({
  kind,
  itemId: null,
  accountId: null,
  quantity: "1",
  unitPrice: "",
  description: "",
  amount: "",
});

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
      lines: [blankLine("item")],
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
    lines: draft.lines.map((line) => ({
      kind: line.kind,
      itemId: line.itemId,
      accountId: line.accountId,
      quantity: String(line.quantity ?? 1),
      unitPrice: line.unitPricePaise === null ? "" : formatDecimal(line.unitPricePaise),
      description: line.description,
      amount: line.kind === "account" ? formatDecimal(line.amountPaise) : "",
    })),
  };
}

// A picked or newly created item fills the line's price; the operator may change it.
function setLineItem(form: InvoiceFormReturn, index: number, item: SavedItem) {
  form.setValue(`lines.${index}.itemId`, item.id, { shouldDirty: true, shouldValidate: true });
  form.setValue(`lines.${index}.unitPrice`, formatDecimal(item.unitPricePaise), {
    shouldDirty: true,
  });
}

function ItemLineFields({
  orgSlug,
  form,
  index,
}: {
  orgSlug: string;
  form: InvoiceFormReturn;
  index: number;
}) {
  const items = useQuery({ ...itemListOptions(orgSlug), select: activeItems });
  const canCreateItem = useCan(orgSlug, { item: ["create"] });
  const [createSeed, setCreateSeed] = useState<string | null>(null);

  return (
    <>
      <FormField
        control={form.control}
        name={`lines.${index}.itemId`}
        render={({ field, fieldState }) => (
          <FormItem>
            <FormLabel>Item</FormLabel>
            <FormControl>
              <LinkField
                items={items.data}
                query={items}
                noun="items"
                getKey={(item) => item.id}
                getLabel={(item) => item.name}
                getCode={(item) => item.hsnSac ?? undefined}
                value={items.data?.find((item) => item.id === field.value) ?? null}
                onSelect={(item) => (item ? setLineItem(form, index, item) : field.onChange(null))}
                onCreate={canCreateItem ? setCreateSeed : undefined}
                placeholder="Choose an item"
                inputRef={field.ref}
                aria-invalid={fieldState.invalid}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <RegisteredFormField
          name={`lines.${index}.quantity`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Quantity</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  required
                  inputMode="numeric"
                  pattern="[0-9]+"
                  className="tabular-nums"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <RegisteredFormField
          name={`lines.${index}.unitPrice`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Unit price</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  required
                  inputMode="decimal"
                  pattern={NON_NEGATIVE_MONEY_PATTERN.source}
                  placeholder="0.00"
                  className="tabular-nums"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <RegisteredFormField
        name={`lines.${index}.description`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Description (optional)</FormLabel>
            <FormControl>
              <Input {...field} maxLength={200} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      {createSeed === null ? null : (
        <ItemSheet
          orgSlug={orgSlug}
          seedName={createSeed}
          onClose={() => setCreateSeed(null)}
          onSaved={(item) => setLineItem(form, index, item)}
        />
      )}
    </>
  );
}

function AccountLineFields({
  orgSlug,
  form,
  index,
}: {
  orgSlug: string;
  form: InvoiceFormReturn;
  index: number;
}) {
  const accounts = useQuery(incomeAccountOptions(orgSlug));

  return (
    <>
      <FormField
        control={form.control}
        name={`lines.${index}.accountId`}
        render={({ field, fieldState }) => (
          <FormItem>
            <FormLabel>Income account</FormLabel>
            <FormControl>
              <LinkField
                items={accounts.data}
                query={accounts}
                noun="income accounts"
                getKey={(account) => account.id}
                getLabel={(account) => account.name}
                getCode={(account) => account.code}
                value={accounts.data?.find((account) => account.id === field.value) ?? null}
                onSelect={(account) => field.onChange(account?.id ?? null)}
                placeholder="Choose an income account"
                inputRef={field.ref}
                aria-invalid={fieldState.invalid}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <RegisteredFormField
        name={`lines.${index}.description`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Description</FormLabel>
            <FormControl>
              <Input {...field} required maxLength={200} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <RegisteredFormField
        name={`lines.${index}.amount`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Amount</FormLabel>
            <FormControl>
              <Input
                {...field}
                required
                inputMode="decimal"
                pattern={NON_NEGATIVE_MONEY_PATTERN.source}
                placeholder="0.00"
                className="tabular-nums"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}

function LinesError({ control }: { control: Control<InvoiceFormValues> }) {
  const { errors } = useFormState({ control, name: "lines", exact: true });
  const message = errors.lines?.message;

  return typeof message === "string" ? (
    <p role="alert" className="text-destructive">
      {message}
    </p>
  ) : null;
}

function InvoiceForm({ orgSlug, today, draft, onClose, onSaved, onPosted }: InvoiceSheetProps) {
  const queryClient = useQueryClient();
  const dueDateEdited = useRef(Boolean(draft?.dueDate));
  // The edit token moves only with this editor's own saves, so a refetch that
  // carries someone else's change leaves it behind and the next save is refused.
  const [draftToken, setDraftToken] = useState(draft && { id: draft.id, version: draft.version });
  const canSave = useCan(orgSlug, { invoice: ["create"] });
  const canPost = useCan(orgSlug, { invoice: ["post"] });
  const form = useZodForm(invoiceSchema, { defaultValues: defaults(today, draft) });
  const linesField = useFieldArray({ control: form.control, name: "lines" });
  const documentDate = useWatch({ control: form.control, name: "documentDate" });

  // The Party's state is the usual place of supply; the operator may change it.
  const defaultPlaceOfSupply = (partyId: string) =>
    queryClient.fetchQuery(orpc.party.get.queryOptions({ input: { orgSlug, partyId } })).then(
      (party) => {
        // A later pick wins over a slower read.
        if (form.getValues("partyId") !== partyId) return;

        form.setValue("placeOfSupplyStateCode", party.stateCode, {
          shouldDirty: true,
          shouldValidate: true,
        });
      },
      (error) => toast.error(errorMessage(error, "Could not load the party's state")),
    );

  const invoiceInput = (values: InvoiceFormValues) => {
    if (!values.partyId) return null;

    const apiLines = values.lines.flatMap((line): InvoiceApiLine[] => {
      if (line.kind === "item") {
        return line.itemId
          ? [
              {
                kind: "item" as const,
                itemId: line.itemId,
                quantity: Number(line.quantity),
                unitPrice: line.unitPrice,
                description: line.description || undefined,
              },
            ]
          : [];
      }

      return line.accountId
        ? [
            {
              kind: "account" as const,
              accountId: line.accountId,
              description: line.description,
              amount: line.amount,
            },
          ]
        : [];
    });

    if (apiLines.length !== values.lines.length) return null;

    return {
      orgSlug,
      partyId: values.partyId,
      documentDate: values.documentDate,
      dueDate: values.dueDate,
      placeOfSupplyStateCode: values.placeOfSupplyStateCode,
      reference: values.reference || undefined,
      narration: values.narration || undefined,
      lines: apiLines,
      draft: draftToken,
    };
  };

  // A CONFLICT means the loaded draft moved on, so the editor closes and the record
  // shows the current state; every other refusal goes to its field.
  const onMutationError = async (error: unknown, fallback: string) => {
    if (hasErrorCode(error, "CONFLICT")) {
      onClose();
      await invalidateDocumentState(queryClient, orgSlug);
      toast.error(errorMessage(error, fallback));

      return;
    }

    applyOrpcFieldError(form, error, SERVER_FIELDS, fallback);
  };

  const save = useMutation(
    orpc.invoice.saveDraft.mutationOptions({
      onSuccess: async (saved) => {
        setDraftToken(saved);
        await invalidateDocumentState(queryClient, orgSlug);
        toast.success("Draft saved");
        onSaved?.(saved.id);
      },
      onError: (error) => onMutationError(error, "Could not save the invoice draft"),
    }),
  );

  const post = useMutation(
    orpc.invoice.post.mutationOptions({
      onSuccess: async ({ id }) => {
        await invalidateDocumentState(queryClient, orgSlug);
        toast.success("Invoice posted");

        // A posted draft goes on to its record; a new invoice stays for Post and next.
        if (draft) onPosted(id);
      },
      onError: async (error) => {
        // Retrying a new invoice could post it twice; a draft's retry is refused by its version.
        if (!draft && !isRefusal(error)) {
          onClose();
          await invalidateDocumentState(queryClient, orgSlug);
          toast.error("The result is uncertain. Check the invoice list before entering it again.");

          return;
        }

        await onMutationError(error, "Could not post the invoice");
      },
    }),
  );

  const saveDraft = form.handleSubmit((values) => {
    const input = invoiceInput(values);

    if (input) save.mutate(input);
  });

  const submit = form.handleSubmit((values) => {
    const input = invoiceInput(values);

    if (input) post.mutate(input);
  });

  const pending = save.isPending || post.isPending;

  const posted = post.data;

  if (posted) {
    return (
      <PostedView
        number={posted.number}
        onDone={() => onPosted(posted.id)}
        onNext={() => {
          form.reset(defaults(form.getValues("documentDate")));
          post.reset();
          dueDateEdited.current = false;
          // Base UI returns focus to the Sheet when this button unmounts; land after it.
          setTimeout(() => form.setFocus("partyId"), 50);
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
                <span className="text-[0.625rem] opacity-70">⌘↵</span>
              </Button>
            ) : null}
          </PostBar>
        }
      >
        <FormField
          control={form.control}
          name="partyId"
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel>Party</FormLabel>
              <FormControl>
                <PartyLinkField
                  orgSlug={orgSlug}
                  value={
                    field.value ? { id: field.value, name: form.getValues("partyName") } : null
                  }
                  onSelect={(party) => {
                    const changed = party?.id !== field.value;

                    field.onChange(party?.id ?? null);
                    form.setValue("partyName", party?.name ?? "");

                    if (!changed) return;

                    form.setValue("placeOfSupplyStateCode", "");

                    if (party) void defaultPlaceOfSupply(party.id);
                  }}
                  inputRef={field.ref}
                  aria-invalid={fieldState.invalid}
                />
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

        <RegisteredFormField
          name="placeOfSupplyStateCode"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Place of supply</FormLabel>
              <FormControl>
                <NativeSelect {...field} required>
                  <option value="" disabled>
                    Choose a state
                  </option>
                  {Object.entries(INDIAN_STATES).map(([code, name]) => (
                    <option key={code} value={code}>
                      {code} · {name}
                    </option>
                  ))}
                </NativeSelect>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <LineGrid
          title="Lines"
          actions={
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={linesField.fields.length >= 100}
                onClick={() => linesField.append(blankLine("item"))}
              >
                Add item
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={linesField.fields.length >= 100}
                onClick={() => linesField.append(blankLine("account"))}
              >
                Add account
              </Button>
            </div>
          }
        >
          {linesField.fields.map((line, index) => (
            <fieldset
              key={line.id}
              className="grid gap-3 border-b border-border pb-4 last:border-b-0 last:pb-0"
            >
              <legend className="sr-only">Invoice line {index + 1}</legend>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">
                  Line {index + 1} · {line.kind === "item" ? "Item" : "Account"}
                </span>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  disabled={linesField.fields.length === 1}
                  aria-label={`Remove line ${index + 1}`}
                  onClick={() => linesField.remove(index)}
                >
                  <Trash2Icon />
                </Button>
              </div>
              {line.kind === "item" ? (
                <ItemLineFields orgSlug={orgSlug} form={form} index={index} />
              ) : (
                <AccountLineFields orgSlug={orgSlug} form={form} index={index} />
              )}
            </fieldset>
          ))}
          <LinesError control={form.control} />
        </LineGrid>

        <section className="grid gap-2 border-y border-border py-3">
          <h3 className="text-muted-foreground">Saved totals</h3>
          {draft ? (
            <InvoiceTotals invoice={draft} />
          ) : (
            <p className="text-muted-foreground">
              Tax, round-off and the total are calculated when the draft is saved or the invoice is
              posted.
            </p>
          )}
        </section>

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
      </DocumentForm>
    </Form>
  );
}

type InvoiceSheetProps = {
  orgSlug: string;
  today: string;
  /** The draft being edited. Its totals stay live; its fields and token are read once. */
  draft?: InvoiceDetail;
  onClose: () => void;
  /** A new invoice's first save, so the caller can open the draft's own editor. */
  onSaved?: (draftId: string) => void;
  onPosted: (invoiceId: string) => void;
};

/** The new-invoice and draft editor; it stays open while a save or post runs. */
export function InvoiceSheet(props: InvoiceSheetProps) {
  const saving =
    useIsMutating({ mutationKey: orpc.invoice.saveDraft.mutationKey() }) +
      useIsMutating({ mutationKey: orpc.invoice.post.mutationKey() }) >
    0;

  return (
    <FormSheet
      open
      onClose={props.onClose}
      saving={saving}
      title={props.draft ? "Edit draft" : "New invoice"}
      description={
        props.draft
          ? "Review the draft, save changes, or post it."
          : "Create a draft or post this invoice."
      }
    >
      <InvoiceForm {...props} />
    </FormSheet>
  );
}
