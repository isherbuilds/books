import {
  ZERO_MONEY,
  absMoney,
  enteredPaise,
  formatMoney,
  isPositiveMoney,
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
import { Trash2Icon } from "lucide-react";
import { skipToken, useInfiniteQuery } from "@tanstack/react-query";
import { useFieldArray, useFormContext, useWatch, Watch } from "react-hook-form";
import { z } from "zod";

import { AllocationTable, sumEntered, type OpenDocument } from "@/components/allocation-table";
import { AmountInput } from "@/components/amount-input";
import { FieldArrayError, LineGrid } from "@/components/document-form";
import { LinkField } from "@/components/link-field";
import { PartyLinkField } from "@/components/party-link-field";
import { useListState, type ListState } from "@/lib/list-state";
import type { PartyPicker } from "@/lib/parties";
import { positiveAmount } from "@/lib/form-schema";
import { openItemsOptions } from "@/lib/pickers";

// Blank is the untouched side of a debit/credit pair.
const entryAmountSchema = z.literal("").or(positiveAmount);

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
    allocations: z.record(z.string(), entryAmountSchema),
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
  allocations: {},
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

function journalPartyAmounts(lines: readonly EntryLineValues[], index: number) {
  const selected = lines[index];

  if (!selected) return { capacity: ZERO_MONEY, allocated: ZERO_MONEY };

  let capacity = ZERO_MONEY;
  let allocated = ZERO_MONEY;

  for (const line of lines) {
    if (line.accountId !== selected.accountId || line.partyId !== selected.partyId) continue;

    capacity += enteredPaise(line.credit) - enteredPaise(line.debit);

    if (line.credit) allocated += sumEntered(Object.values(line.allocations));
  }

  return { capacity: capacity > ZERO_MONEY ? capacity : ZERO_MONEY, allocated };
}

/**
 * What line `index` may allocate to one invoice. Sibling lines share both the party's
 * credit and the invoice's outstanding, so each counts the other lines' amounts.
 */
export function journalAllocationLimit(
  lines: readonly EntryLineValues[],
  index: number,
  documentId: string,
  openPaise: bigint,
) {
  const own = enteredPaise(lines[index]?.allocations[documentId] ?? "");
  const { capacity, allocated } = journalPartyAmounts(lines, index);

  const invoiceLeft =
    openPaise - sumEntered(lines.map((line) => line.allocations[documentId] ?? "")) + own;

  const partyLeft = capacity - allocated + own;

  return partyLeft < invoiceLeft ? partyLeft : invoiceLeft;
}

function JournalAllocationTotals({ index }: { index: number }) {
  const { control } = useFormContext<{ lines: EntryLineValues[] }>();
  const lines = useWatch({ control, name: "lines" });
  const { capacity, allocated } = journalPartyAmounts(lines, index);
  const remaining = capacity - allocated;

  return (
    <dl className="grid gap-1 border-t border-border pt-2">
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-muted-foreground">Party allocated</dt>
        <dd className="tabular-nums">{formatMoney(allocated)}</dd>
      </div>
      <div className="flex items-baseline justify-between gap-4 font-medium">
        <dt>{remaining < ZERO_MONEY ? "Over by" : "Remaining to allocate"}</dt>
        <dd className="tabular-nums">
          {formatMoney(remaining < ZERO_MONEY ? -remaining : remaining)}
        </dd>
      </div>
    </dl>
  );
}

function JournalInvoiceAllocations({ orgSlug, index }: { orgSlug: string; index: number }) {
  const form = useFormContext<{ lines: EntryLineValues[] }>();
  const partyId = useWatch({ control: form.control, name: `lines.${index}.partyId` });
  const credit = useWatch({ control: form.control, name: `lines.${index}.credit` });
  const showInvoices = credit !== "" && !!partyId;

  const openItems = useInfiniteQuery(
    openItemsOptions(
      showInvoices ? { orgSlug, partyId, side: "receivable", type: "invoice" } : skipToken,
    ),
  );

  const invoices: OpenDocument[] =
    openItems.data?.pages.flatMap((page) =>
      page.rows.map((row) => ({
        ...row,
        label: "Invoice",
        openPaise: row.outstandingPaise,
      })),
    ) ?? [];

  if (!showInvoices) return null;

  return (
    <div className="col-span-2 md:col-span-full">
      <AllocationTable
        title="Open invoices"
        openHeading="Outstanding"
        query={openItems}
        rows={invoices}
        name={`lines.${index}.allocations`}
        remainingFor={(documentId) =>
          journalAllocationLimit(
            form.getValues("lines"),
            index,
            documentId,
            invoices.find((row) => row.id === documentId)?.openPaise ?? ZERO_MONEY,
          )
        }
      >
        <JournalAllocationTotals index={index} />
      </AllocationTable>
    </div>
  );
}

function EntryLineFields({
  orgSlug,
  gridTemplate,
  index,
  accounts,
  parties,
  onCreateParty,
  autoFocus,
  removeDisabled,
  remove,
}: {
  orgSlug: string;
  gridTemplate: string;
  index: number;
  accounts: ListState<EntryAccount[]>;
  parties?: ListState<PartyPicker>;
  onCreateParty?: (index: number, seed: string) => void;
  autoFocus: boolean;
  removeDisabled: boolean;
  /** `useFieldArray`'s stable `remove`, so a row's props change only with its own index. */
  remove: (index: number) => void;
}) {
  const form = useFormContext<{ lines: EntryLineValues[] }>();
  const accountId = useWatch({ control: form.control, name: `lines.${index}.accountId` });

  const receivables =
    accounts.data?.find((account) => account.id === accountId)?.systemKey === "receivables";

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
        render={({ field }) => (
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
                onSelect={(account) => {
                  if (account?.id !== field.value) form.setValue(`lines.${index}.allocations`, {});
                  field.onChange(account?.id ?? null);
                }}
                placeholder="Choose an account"
                inputRef={field.ref}
                autoFocus={autoFocus}
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
          render={({ field }) => (
            <FormItem className="col-span-2 md:col-span-1">
              <FormLabel className="md:sr-only">
                {receivables ? "Party (required)" : "Party (optional)"}
              </FormLabel>
              <FormControl>
                <PartyLinkField
                  orgSlug={orgSlug}
                  parties={parties}
                  value={
                    field.value
                      ? { id: field.value, name: form.getValues(`lines.${index}.partyName`) }
                      : null
                  }
                  onSelect={(party) => {
                    if (party?.id !== field.value) form.setValue(`lines.${index}.allocations`, {});
                    field.onChange(party?.id ?? null);
                    form.setValue(`lines.${index}.partyName`, party?.name ?? "");
                  }}
                  onCreate={onCreateParty ? (seed) => onCreateParty(index, seed) : undefined}
                  clearable
                  inputRef={field.ref}
                />
              </FormControl>
              <FormDescription className={receivables ? undefined : "sr-only"}>
                {receivables ? "Changes what this party owes" : "Shown in the day book only."}
              </FormDescription>
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
                    <AmountInput
                      {...field}
                      onChange={(event) => {
                        field.onChange(event);

                        if (event.target.value) {
                          form.setValue(`lines.${index}.${other}`, "", { shouldValidate: true });

                          if (side === "debit") form.setValue(`lines.${index}.allocations`, {});
                        }
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          );
        })}
      </div>
      {receivables ? <JournalInvoiceAllocations orgSlug={orgSlug} index={index} /> : null}

      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        disabled={removeDisabled}
        aria-label={`Remove line ${index + 1}`}
        className="col-span-2 justify-self-end md:col-span-1"
        onClick={() => remove(index)}
      >
        <Trash2Icon />
      </Button>
    </fieldset>
  );
}

const NO_PARTIES: ListState<PartyPicker> = { isPending: false, isError: false, error: null };

export function EntryLines({
  orgSlug,
  title,
  accounts,
  parties,
  onCreateParty,
  autoFocusFirst,
}: {
  orgSlug: string;
  title: string;
  accounts: ListState<EntryAccount[]>;
  parties?: ListState<PartyPicker>;
  onCreateParty?: (index: number, seed: string) => void;
  autoFocusFirst: boolean;
}) {
  const form = useFormContext<{ lines: EntryLineValues[] }>();
  const lineFields = useFieldArray({ control: form.control, name: "lines" });
  const accountState = useListState(accounts);
  // Hooks cannot be conditional; the party state is dropped when the grid has no parties.
  const partyState = useListState(parties ?? NO_PARTIES);
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
            "hidden items-center gap-2 text-sm text-muted-foreground md:grid",
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
            orgSlug={orgSlug}
            index={index}
            gridTemplate={gridTemplate}
            accounts={accountState}
            parties={parties ? partyState : undefined}
            onCreateParty={onCreateParty}
            autoFocus={autoFocusFirst && index === 0}
            removeDisabled={lineFields.fields.length <= 2}
            remove={lineFields.remove}
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
          // The closing rule marks an entry that balances, not an empty one.
          const balanced = difference === ZERO_MONEY && isPositiveMoney(debit);

          return (
            <dl
              className={cn(
                "grid gap-1 border-t border-foreground py-3 text-sm md:gap-2",
                gridTemplate,
              )}
            >
              <div className="grid gap-1 md:col-start-[-3] md:grid-cols-2 md:gap-2">
                <div className="flex items-baseline justify-between gap-4 md:block">
                  <dt className="text-muted-foreground md:sr-only">Debit total</dt>
                  <dd className={cn("text-right tabular-nums", balanced && "closing-total")}>
                    {formatMoney(debit)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 md:block">
                  <dt className="text-muted-foreground md:sr-only">Credit total</dt>
                  <dd className={cn("text-right tabular-nums", balanced && "closing-total")}>
                    {formatMoney(credit)}
                  </dd>
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
