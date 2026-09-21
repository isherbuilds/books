import {
  NON_NEGATIVE_MONEY_PATTERN,
  ZERO_MONEY,
  absMoney,
  enteredPaise,
  formatMoney,
  parseMoney,
} from "@accly/api/core/money";
import type { AppRouterClient } from "@accly/api/routers/index";
import { ENTRY_SIDES } from "@accly/db/schema/document-lines";
import { Button } from "@accly/ui/components/button";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@accly/ui/components/form";
import { Input } from "@accly/ui/components/input";
import { ToggleGroup, ToggleGroupItem } from "@accly/ui/components/toggle-group";
import type { UseQueryResult } from "@tanstack/react-query";
import { Trash2Icon } from "lucide-react";
import { Watch, useFieldArray, useFormContext } from "react-hook-form";
import { z } from "zod";

import { FieldArrayError, LineGrid } from "@/components/document-form";
import { LinkField } from "@/components/link-field";
import { PartyLinkField } from "@/components/party-link-field";
import type { PartyOption } from "@/lib/parties";

const entryLineSchema = z.object({
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

export const entryLinesSchema = z
  .array(entryLineSchema)
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

type EntryLineValues = z.input<typeof entryLineSchema>;

type EntryAccount = Awaited<ReturnType<AppRouterClient["journal"]["accounts"]>>[number];

export const blankEntryLine = (side: EntryLineValues["side"]): EntryLineValues => ({
  accountId: null,
  side,
  amount: "",
  partyId: null,
  partyName: "",
  description: "",
});

function EntryLineFields({
  index,
  accounts,
  parties,
  onCreateParty,
  autoFocus,
  removeDisabled,
  onRemove,
}: {
  index: number;
  accounts: UseQueryResult<EntryAccount[]>;
  parties?: UseQueryResult<PartyOption[]>;
  onCreateParty?: (index: number, seed: string) => void;
  autoFocus: boolean;
  removeDisabled: boolean;
  onRemove: () => void;
}) {
  const form = useFormContext<{ lines: EntryLineValues[] }>();

  return (
    <fieldset className="grid gap-3 border-b border-border pb-4 last:border-b-0 last:pb-0">
      <legend className="sr-only">Entry line {index + 1}</legend>
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

      {parties ? (
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
                  onCreate={onCreateParty ? (seed) => onCreateParty(index, seed) : undefined}
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
      ) : null}
    </fieldset>
  );
}

export function EntryLines({
  title,
  accounts,
  parties,
  onCreateParty,
  autoFocusFirst,
}: {
  title: string;
  accounts: UseQueryResult<EntryAccount[]>;
  parties?: UseQueryResult<PartyOption[]>;
  onCreateParty?: (index: number, seed: string) => void;
  autoFocusFirst: boolean;
}) {
  const form = useFormContext<{ lines: EntryLineValues[] }>();
  const lineFields = useFieldArray({ control: form.control, name: "lines" });

  return (
    <>
      <LineGrid
        title={title}
        actions={
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={lineFields.fields.length >= 100}
            onClick={() => lineFields.append(blankEntryLine("debit"))}
          >
            Add line
          </Button>
        }
      >
        {lineFields.fields.map((line, index) => (
          <EntryLineFields
            key={line.id}
            index={index}
            accounts={accounts}
            parties={parties}
            onCreateParty={onCreateParty}
            autoFocus={autoFocusFirst && index === 0}
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
    </>
  );
}
