import {
  NON_NEGATIVE_MONEY_PATTERN,
  ZERO_MONEY,
  absMoney,
  enteredPaise,
  formatMoney,
} from "@accly/api/core/money";
import type { AppRouterClient } from "@accly/api/routers/index";
import type { EntrySide } from "@accly/db/schema/document-lines";
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
import { cn } from "@accly/ui/lib/utils";
import type { UseQueryResult } from "@tanstack/react-query";
import { Trash2Icon } from "lucide-react";
import { useFieldArray, useFormContext, Watch } from "react-hook-form";
import { z } from "zod";

import { FieldArrayError, LineGrid } from "@/components/document-form";
import { LinkField } from "@/components/link-field";
import { PartyLinkField } from "@/components/party-link-field";
import type { PartyOption } from "@/lib/parties";

const entryAmountSchema = z
  .string()
  .refine(
    (value) => value === "" || (NON_NEGATIVE_MONEY_PATTERN.test(value) && Number(value) > 0),
    "Enter a valid amount",
  );

const entryLineSchema = z
  .object({
    accountId: z
      .string()
      .nullable()
      .refine((value): value is string => value !== null, "Choose an account"),
    debit: entryAmountSchema,
    credit: entryAmountSchema,
    partyId: z.string().nullable(),
    partyName: z.string(),
    description: z.string().trim().max(200, "Description must be 200 characters or fewer"),
  })
  .superRefine((line, context) => {
    if ((line.debit === "") === (line.credit === "")) {
      context.addIssue({
        code: "custom",
        path: ["debit"],
        message: "Enter a debit or a credit",
      });
    }
  });

function entryTotals(lines: readonly { debit: string; credit: string }[]): {
  debit: bigint;
  credit: bigint;
} {
  let debit = ZERO_MONEY;
  let credit = ZERO_MONEY;

  for (const line of lines) {
    debit += enteredPaise(line.debit);
    credit += enteredPaise(line.credit);
  }

  return { debit, credit };
}

export const entryLinesSchema = z
  .array(entryLineSchema)
  .min(2, "Add at least two lines")
  .max(100)
  .superRefine((lines, context) => {
    const { debit, credit } = entryTotals(lines);

    if (debit === ZERO_MONEY || credit === ZERO_MONEY || debit !== credit) {
      context.addIssue({ code: "custom", message: "Debits must equal credits." });
    }
  });

type EntryLineValues = z.input<typeof entryLineSchema>;

type EntryAccount = Awaited<ReturnType<AppRouterClient["journal"]["accounts"]>>[number];

export const blankEntryLine = (): EntryLineValues => ({
  accountId: null,
  debit: "",
  credit: "",
  partyId: null,
  partyName: "",
  description: "",
});

type EntryLineInput = {
  accountId: string;
  side: EntrySide;
  amount: string;
  partyId?: string;
  description?: string;
};

/** The API shape of entered lines: one side and amount each, blanks omitted. */
export function entryLinesInput(lines: readonly z.output<typeof entryLineSchema>[]) {
  return lines.map((line) => {
    const input: EntryLineInput =
      line.debit !== ""
        ? { accountId: line.accountId, side: "debit", amount: line.debit }
        : { accountId: line.accountId, side: "credit", amount: line.credit };

    // Opening balance lines are strict objects without a party key.
    if (line.partyId) input.partyId = line.partyId;

    if (line.description) input.description = line.description;

    return input;
  });
}

const ENTRY_GRID_WITH_PARTY =
  "md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.5fr)_14rem_2rem]";

const ENTRY_GRID_WITHOUT_PARTY = "md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_14rem_2rem]";

function EntryLineFields({
  gridTemplate,
  index,
  accounts,
  parties,
  onCreateParty,
  autoFocus,
  removeDisabled,
  onRemove,
}: {
  gridTemplate: string;
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
    <fieldset
      className={cn(
        "grid grid-cols-2 gap-2 border-b border-border py-2 last:border-b-0 md:items-start",
        gridTemplate,
      )}
    >
      <legend className="sr-only">Line {index + 1}</legend>

      <FormField
        control={form.control}
        name={`lines.${index}.accountId`}
        render={({ field, fieldState }) => (
          <FormItem className="col-span-2 md:col-span-1">
            <FormLabel className="md:sr-only">Account</FormLabel>
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

      <RegisteredFormField
        name={`lines.${index}.description`}
        render={({ field }) => (
          <FormItem className="col-span-2 md:col-span-1">
            <FormLabel className="md:sr-only">Description (optional)</FormLabel>
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
            <FormItem className="col-span-2 md:col-span-1">
              <FormLabel className="md:sr-only">Party (optional)</FormLabel>
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
              <FormDescription className="sr-only">Shown in the day book only.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}

      <div className="col-span-2 grid grid-cols-2 gap-2 md:col-span-1">
        {(["debit", "credit"] as const).map((side) => {
          const other = side === "debit" ? "credit" : "debit";

          return (
            <RegisteredFormField
              key={side}
              name={`lines.${index}.${side}`}
              rules={{ deps: [`lines.${index}.${other}`] }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="md:sr-only">
                    {side === "debit" ? "Debit" : "Credit"}
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      onChange={(event) => {
                        field.onChange(event);

                        if (event.target.value) {
                          form.setValue(`lines.${index}.${other}`, "", { shouldValidate: true });
                        }
                      }}
                      inputMode="decimal"
                      pattern={NON_NEGATIVE_MONEY_PATTERN.source}
                      placeholder="0.00"
                      className="text-right tabular-nums"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          );
        })}
      </div>

      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        disabled={removeDisabled}
        aria-label={`Remove line ${index + 1}`}
        className="col-span-2 justify-self-end md:col-span-1"
        onClick={onRemove}
      >
        <Trash2Icon />
      </Button>
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
  const gridTemplate = parties ? ENTRY_GRID_WITH_PARTY : ENTRY_GRID_WITHOUT_PARTY;

  return (
    <>
      <LineGrid
        title={title}
        actions={
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="justify-self-start"
            disabled={lineFields.fields.length >= 100}
            onClick={() => lineFields.append(blankEntryLine())}
          >
            Add line
          </Button>
        }
      >
        <div
          className={cn(
            "hidden items-center gap-2 text-xs text-muted-foreground md:grid",
            gridTemplate,
          )}
        >
          <span>Account</span>
          <span>Description</span>
          {parties ? <span title="Shown in the day book only.">Party</span> : null}
          <div className="grid grid-cols-2 gap-2">
            <span className="text-right">Debit</span>
            <span className="text-right">Credit</span>
          </div>
          <span aria-hidden="true" />
        </div>

        {lineFields.fields.map((line, index) => (
          <EntryLineFields
            key={line.id}
            index={index}
            gridTemplate={gridTemplate}
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
          const { debit, credit } = entryTotals(lines);
          const difference = absMoney(debit - credit);

          return (
            <dl
              className={cn(
                "grid gap-1 border-y border-border py-3 text-xs md:gap-2",
                gridTemplate,
              )}
            >
              <div className="grid gap-1 md:col-start-[-3] md:grid-cols-2 md:gap-2">
                <div className="flex items-baseline justify-between gap-4 md:block">
                  <dt className="text-muted-foreground md:sr-only">Debit total</dt>
                  <dd className="text-right tabular-nums">{formatMoney(debit)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 md:block">
                  <dt className="text-muted-foreground md:sr-only">Credit total</dt>
                  <dd className="text-right tabular-nums">{formatMoney(credit)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 font-medium md:col-span-2">
                  <dt>Difference</dt>
                  <dd
                    className={cn("tabular-nums", difference !== ZERO_MONEY && "text-destructive")}
                  >
                    {formatMoney(difference)}
                  </dd>
                </div>
              </div>
            </dl>
          );
        }}
      />
    </>
  );
}
