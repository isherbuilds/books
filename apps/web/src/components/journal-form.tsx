import {
  NON_NEGATIVE_MONEY_PATTERN,
  ZERO_MONEY,
  absMoney,
  enteredPaise,
  formatMoney,
  parseMoney,
} from "@accly/api/core/money";
import type { AppRouterClient } from "@accly/api/routers/index";
import { Button } from "@accly/ui/components/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@accly/ui/components/form";
import { Input } from "@accly/ui/components/input";
import { Textarea } from "@accly/ui/components/textarea";
import { ToggleGroup, ToggleGroupItem } from "@accly/ui/components/toggle-group";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Watch, useFieldArray, type FieldPath, type UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  DocumentForm,
  FieldArrayError,
  LineGrid,
  PostBar,
  PostedView,
} from "@/components/document-form";
import { LinkField } from "@/components/link-field";
import { PartyLinkField } from "@/components/party-link-field";
import { PartySheet } from "@/components/party-form";
import { useZodForm } from "@/hooks/use-zod-form";
import { invalidateJournalState } from "@/lib/domain-invalidation";
import { journalAccountOptions } from "@/lib/journals";
import { useCan } from "@/lib/membership";
import { partyPickerOptions, type PartyOption } from "@/lib/parties";
import { orpc } from "@/lib/orpc";
import { applyOrpcFieldError, isRefusal } from "@/lib/orpc-error";

const ENTRY_SIDES = ["debit", "credit"] as const;

const lineSchema = z.object({
  accountId: z
    .string()
    .nullable()
    .refine((value): value is string => value !== null, "Choose an account"),
  side: z.enum(ENTRY_SIDES),
  amount: z
    .string()
    .regex(NON_NEGATIVE_MONEY_PATTERN, "Enter a valid amount")
    .refine((value) => Number(value) > 0, "Amount must be greater than zero"),
  partyId: z.string().nullable(),
  partyName: z.string(),
  description: z.string().trim().max(200, "Description must be 200 characters or fewer"),
});

const linesSchema = z
  .array(lineSchema)
  .min(2, "Add at least two lines")
  .max(100)
  .superRefine((lines, context) => {
    let debit = ZERO_MONEY;
    let credit = ZERO_MONEY;
    let hasDebit = false;
    let hasCredit = false;

    for (const line of lines) {
      if (!NON_NEGATIVE_MONEY_PATTERN.test(line.amount) || Number(line.amount) <= 0) continue;

      const amount = parseMoney(line.amount);

      if (line.side === "debit") {
        debit += amount;
        hasDebit = true;
      } else {
        credit += amount;
        hasCredit = true;
      }
    }

    if (!hasDebit || !hasCredit || debit !== credit) {
      context.addIssue({ code: "custom", message: "Debits must equal credits." });
    }
  });

const journalSchema = z.object({
  documentDate: z.iso.date(),
  narration: z.string().trim().min(1, "Enter a narration").max(500),
  reference: z.string().trim().max(120, "Reference must be 120 characters or fewer"),
  lines: linesSchema,
});

type JournalFormValues = z.input<typeof journalSchema>;

type JournalFormReturn = UseFormReturn<JournalFormValues, unknown, z.output<typeof journalSchema>>;

type JournalAccount = Awaited<ReturnType<AppRouterClient["journal"]["accounts"]>>[number];

type JournalLine = JournalFormValues["lines"][number];

const SERVER_FIELDS = {
  ACCOUNT_INVALID: "lines",
  TAXABLE_ACCOUNT_LINE: "lines",
  PARTY_INVALID: "lines",
} satisfies Record<string, FieldPath<JournalFormValues>>;

const blankLine = (side: JournalLine["side"]): JournalLine => ({
  accountId: null,
  side,
  amount: "",
  partyId: null,
  partyName: "",
  description: "",
});

function defaults(documentDate: string): JournalFormValues {
  return {
    documentDate,
    narration: "",
    reference: "",
    lines: [blankLine("debit"), blankLine("credit")],
  };
}

function JournalLineFields({
  form,
  index,
  accounts,
  parties,
  onCreateParty,
  autoFocus,
  removeDisabled,
  onRemove,
}: {
  form: JournalFormReturn;
  index: number;
  accounts: UseQueryResult<JournalAccount[]>;
  parties: UseQueryResult<PartyOption[]>;
  onCreateParty?: (seed: string) => void;
  autoFocus: boolean;
  removeDisabled: boolean;
  onRemove: () => void;
}) {
  return (
    <fieldset className="grid gap-3 border-b border-border pb-4 last:border-b-0 last:pb-0">
      <legend className="sr-only">Journal line {index + 1}</legend>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Line {index + 1}</span>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          disabled={removeDisabled}
          aria-label={`Remove line ${index + 1}`}
          onClick={onRemove}
        >
          <Trash2Icon />
        </Button>
      </div>

      <FormField
        control={form.control}
        name={`lines.${index}.accountId`}
        render={({ field, fieldState }) => (
          <FormItem>
            <FormLabel>Account</FormLabel>
            <FormControl>
              <LinkField
                items={accounts.data}
                query={accounts}
                noun="accounts"
                getKey={(account) => account.id}
                getLabel={(account) => account.name}
                getCode={(account) => account.code}
                value={accounts.data?.find((account) => account.id === field.value) ?? null}
                onSelect={(account) => field.onChange(account?.id ?? null)}
                placeholder="Choose an account"
                inputRef={field.ref}
                autoFocus={autoFocus}
                aria-invalid={fieldState.invalid}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          control={form.control}
          name={`lines.${index}.side`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Side</FormLabel>
              <FormControl>
                <ToggleGroup
                  value={[field.value]}
                  onValueChange={(next) => {
                    const side = ENTRY_SIDES.find((each) => each === next[0]);

                    if (side) field.onChange(side);
                  }}
                  spacing={1}
                  variant="outline"
                  aria-label={`Side for line ${index + 1}`}
                >
                  <ToggleGroupItem value="debit">Debit</ToggleGroupItem>
                  <ToggleGroupItem value="credit">Credit</ToggleGroupItem>
                </ToggleGroup>
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

      <FormField
        control={form.control}
        name={`lines.${index}.partyId`}
        render={({ field, fieldState }) => (
          <FormItem>
            <FormLabel>Party (optional)</FormLabel>
            <FormControl>
              <PartyLinkField
                parties={parties}
                value={
                  field.value
                    ? { id: field.value, name: form.getValues(`lines.${index}.partyName`) }
                    : null
                }
                onSelect={(party) => {
                  field.onChange(party?.id ?? null);
                  form.setValue(`lines.${index}.partyName`, party?.name ?? "");
                }}
                onCreate={onCreateParty}
                clearable
                inputRef={field.ref}
                aria-invalid={fieldState.invalid}
              />
            </FormControl>
            <FormDescription>Shown in the day book only.</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </fieldset>
  );
}

export function JournalForm({
  orgSlug,
  today,
  onClose,
}: {
  orgSlug: string;
  today: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const form = useZodForm(journalSchema, { defaultValues: defaults(today) });

  const lineFields = useFieldArray({ control: form.control, name: "lines" });
  const accounts = useQuery(journalAccountOptions(orgSlug));
  const parties = useQuery(partyPickerOptions(orgSlug));
  const canCreateParty = useCan(orgSlug, { party: ["create"] });
  const [createParty, setCreateParty] = useState<{ index: number; seed: string } | null>(null);

  // A voucher entered after Post and next lands on its first line; the first open keeps
  // the Sheet's default (the date). `reset` keeps the count, so the remount can tell.
  const entered = form.formState.submitCount > 0;

  const post = useMutation(
    orpc.journal.post.mutationOptions({
      onSuccess: async () => {
        await invalidateJournalState(queryClient, orgSlug);
      },
      onError: async (error) => {
        if (!isRefusal(error)) {
          onClose();
          await invalidateJournalState(queryClient, orgSlug);
          toast.error("The result is uncertain. Check the journal list before entering it again.");

          return;
        }

        applyOrpcFieldError(form, error, SERVER_FIELDS, "Could not post the journal");
      },
    }),
  );

  const submit = form.handleSubmit((values) => {
    post.mutate({
      orgSlug,
      documentDate: values.documentDate,
      narration: values.narration,
      reference: values.reference || undefined,
      lines: values.lines.map((line) => ({
        accountId: line.accountId,
        side: line.side,
        amount: line.amount,
        partyId: line.partyId ?? undefined,
        description: line.description || undefined,
      })),
    });
  });

  const posted = post.data;

  if (posted) {
    return (
      <PostedView
        number={posted.number}
        onDone={onClose}
        onNext={() => {
          const { documentDate } = form.getValues();
          form.reset(defaults(documentDate), { keepSubmitCount: true });
          post.reset();
        }}
      />
    );
  }

  return (
    <Form {...form}>
      <DocumentForm
        pending={post.isPending}
        onSubmit={(event) => void submit(event)}
        footer={
          <PostBar onClose={onClose} closeLabel="Close">
            <Button type="submit">
              {post.isPending ? "Posting…" : post.isError ? "Post again" : "Post journal"}
              <span className="text-[0.625rem] opacity-70">⌘↵</span>
            </Button>
          </PostBar>
        }
      >
        <RegisteredFormField
          name="documentDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Journal date</FormLabel>
              <FormControl>
                <Input {...field} required type="date" />
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
                <Textarea {...field} required maxLength={500} rows={3} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <RegisteredFormField
          name="reference"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Reference (optional)</FormLabel>
              <FormControl>
                <Input {...field} maxLength={120} autoComplete="off" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <LineGrid
          title="Lines"
          actions={
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={lineFields.fields.length >= 100}
              onClick={() => lineFields.append(blankLine("debit"))}
            >
              Add line
            </Button>
          }
        >
          {lineFields.fields.map((line, index) => (
            <JournalLineFields
              key={line.id}
              form={form}
              index={index}
              accounts={accounts}
              parties={parties}
              onCreateParty={canCreateParty ? (seed) => setCreateParty({ index, seed }) : undefined}
              autoFocus={entered && index === 0}
              removeDisabled={lineFields.fields.length <= 2}
              onRemove={() => lineFields.remove(index)}
            />
          ))}
          <FieldArrayError control={form.control} name="lines" />
        </LineGrid>

        <Watch
          control={form.control}
          name="lines"
          render={(lines) => {
            let debit = ZERO_MONEY;
            let credit = ZERO_MONEY;

            for (const line of lines) {
              const amount = enteredPaise(line.amount);

              if (line.side === "debit") debit += amount;
              else credit += amount;
            }

            return (
              <dl className="grid gap-1 border-y border-border py-3 text-xs">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">Debit total</dt>
                  <dd className="tabular-nums">{formatMoney(debit)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">Credit total</dt>
                  <dd className="tabular-nums">{formatMoney(credit)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 font-medium">
                  <dt>Difference</dt>
                  <dd className="tabular-nums">{formatMoney(absMoney(debit - credit))}</dd>
                </div>
              </dl>
            );
          }}
        />
      </DocumentForm>
      <PartySheet
        orgSlug={orgSlug}
        open={createParty !== null}
        seedName={createParty?.seed ?? ""}
        // Base UI returns focus to the Party field that opened the Sheet.
        onClose={() => setCreateParty(null)}
        onSaved={(party) => {
          if (!createParty) return;

          const { index } = createParty;
          form.setValue(`lines.${index}.partyId`, party.id, {
            shouldDirty: true,
            shouldValidate: true,
          });
          form.setValue(`lines.${index}.partyName`, party.name, { shouldDirty: true });
          setCreateParty(null);
        }}
      />
    </Form>
  );
}
