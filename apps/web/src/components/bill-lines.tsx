import { NON_NEGATIVE_MONEY_PATTERN } from "@accly/api/core/money";
import type { AppRouterClient } from "@accly/api/routers/index";
import { Button } from "@accly/ui/components/button";
import { Checkbox } from "@accly/ui/components/checkbox";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@accly/ui/components/form";
import { Input } from "@accly/ui/components/input";
import { skipToken, useQuery } from "@tanstack/react-query";
import { Trash2Icon } from "lucide-react";
import { useFieldArray, useFormContext } from "react-hook-form";
import { z } from "zod";

import { FieldArrayError, LineGrid } from "@/components/document-form";
import { LinkField } from "@/components/link-field";
import { accountListOptions, postableAccounts, type AccountListRow } from "@/lib/accounts";
import { positiveAmount } from "@/lib/form-schema";
import { useListState, type ListState } from "@/lib/list-state";
import { orpc } from "@/lib/orpc";

export const lineSchema = z.object({
  accountId: z.string().min(1, "Choose an expense or asset account"),
  description: z.string().trim().min(1, "Enter a description").max(200),
  hsnSac: z
    .string()
    .trim()
    .regex(/^(\d{4,8})?$/, "Use a 4 to 8 digit HSN/SAC code"),
  amount: positiveAmount,
  taxCode: z.string(),
  itcEligible: z.boolean(),
});

type BillLine = z.input<typeof lineSchema>;

type TaxRate = Awaited<ReturnType<AppRouterClient["item"]["taxRates"]>>[number];

export const blankLine = (): BillLine => ({
  accountId: "",
  description: "",
  hsnSac: "",
  amount: "",
  taxCode: "",
  itcEligible: false,
});

// Module scope, so the selection holds while the cached chart is unchanged.
const billAccounts = (rows: AccountListRow[]) => postableAccounts(rows, ["expense", "asset"]);

// Account, description, HSN/SAC, GST rate, amount, ITC, remove. Below `md` each cell stacks.
const ROW = "md:grid-cols-[minmax(0,3fr)_minmax(0,3fr)_6rem_minmax(0,2fr)_8rem_2.5rem_1.5rem]";

function BillLineRow({
  index,
  accounts,
  rates,
  registered,
  removeDisabled,
  remove,
}: {
  index: number;
  accounts: ListState<AccountListRow[]>;
  rates: ListState<TaxRate[]>;
  registered: boolean;
  removeDisabled: boolean;
  /** `useFieldArray`'s stable `remove`, so a row's props change only with its own index. */
  remove: (index: number) => void;
}) {
  const form = useFormContext<{ lines: BillLine[] }>();

  return (
    <fieldset
      className={`grid grid-cols-2 gap-2 border-b border-border py-2 last:border-b-0 md:items-start ${ROW}`}
    >
      <legend className="sr-only">Bill line {index + 1}</legend>
      <FormField
        control={form.control}
        name={`lines.${index}.accountId`}
        render={({ field, fieldState }) => (
          <FormItem className="col-span-2 md:col-span-1">
            <FormLabel className="md:sr-only">Expense or asset account</FormLabel>
            <FormControl>
              <LinkField
                items={accounts.data}
                query={accounts}
                noun="expense or asset accounts"
                getKey={(account) => account.id}
                getLabel={(account) => account.name}
                getCode={(account) => account.code}
                value={accounts.data?.find((account) => account.id === field.value) ?? null}
                onSelect={(account) => field.onChange(account?.id ?? "")}
                placeholder="Choose an account"
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
          <FormItem className="col-span-2 md:col-span-1">
            <FormLabel className="md:sr-only">Description</FormLabel>
            <FormControl>
              <Input {...field} required maxLength={200} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <RegisteredFormField
        name={`lines.${index}.hsnSac`}
        render={({ field }) => (
          <FormItem>
            <FormLabel className="md:sr-only">HSN/SAC (optional)</FormLabel>
            <FormControl>
              <Input {...field} maxLength={20} className="font-mono" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name={`lines.${index}.taxCode`}
        render={({ field, fieldState }) => (
          <FormItem>
            <FormLabel className="md:sr-only">GST rate (optional)</FormLabel>
            <FormControl>
              <LinkField
                items={rates.data}
                query={rates}
                noun="GST rates"
                getKey={(rate) => rate.code}
                getLabel={(rate) => rate.name}
                getCode={(rate) => rate.code}
                value={rates.data?.find((rate) => rate.code === field.value) ?? null}
                onSelect={(rate) => field.onChange(rate?.code ?? "")}
                clearable
                placeholder="GST rate"
                inputRef={field.ref}
                aria-invalid={fieldState.invalid}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <RegisteredFormField
        name={`lines.${index}.amount`}
        render={({ field }) => (
          <FormItem>
            <FormLabel className="md:sr-only">Taxable amount</FormLabel>
            <FormControl>
              <Input
                {...field}
                required
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
      {registered ? (
        <FormField
          control={form.control}
          name={`lines.${index}.itcEligible`}
          render={({ field }) => (
            <FormItem className="flex items-center gap-2 md:mt-2 md:justify-center">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                />
              </FormControl>
              <FormLabel className="md:sr-only">ITC eligible</FormLabel>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : (
        <span aria-hidden className="hidden md:block" />
      )}
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className="justify-self-end md:mt-1"
        disabled={removeDisabled}
        aria-label={`Remove line ${index + 1}`}
        onClick={() => remove(index)}
      >
        <Trash2Icon />
      </Button>
    </fieldset>
  );
}

/** The bill's line grid: one expense or asset line per row. */
export function BillLines({
  orgSlug,
  registered,
  documentDate,
}: {
  orgSlug: string;
  registered: boolean;
  /** A valid bill date, or `undefined` while the field is being edited. */
  documentDate: string | undefined;
}) {
  const form = useFormContext<{ lines: BillLine[] }>();
  const linesField = useFieldArray({ control: form.control, name: "lines" });

  // One subscription per editor: every line reads these results through props.
  const accounts = useListState<AccountListRow[]>(
    useQuery({ ...accountListOptions(orgSlug), select: billAccounts }),
  );

  const rates = useListState<TaxRate[]>(
    useQuery(
      orpc.item.taxRates.queryOptions({
        input: documentDate ? { orgSlug, date: documentDate } : skipToken,
      }),
    ),
  );

  return (
    <LineGrid
      title="Lines"
      actions={
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="justify-self-start"
          disabled={linesField.fields.length >= 100}
          onClick={() => linesField.append(blankLine())}
        >
          Add line
        </Button>
      }
    >
      <div className={`hidden gap-2 text-muted-foreground md:grid ${ROW}`}>
        <span>Account</span>
        <span>Description</span>
        <span>HSN/SAC</span>
        <span>GST rate</span>
        <span className="text-right">Amount</span>
        <span className="text-center">{registered ? "ITC" : null}</span>
        <span aria-hidden />
      </div>
      <div>
        {linesField.fields.map((line, index) => (
          <BillLineRow
            key={line.id}
            index={index}
            accounts={accounts}
            rates={rates}
            registered={registered}
            removeDisabled={linesField.fields.length === 1}
            remove={linesField.remove}
          />
        ))}
      </div>
      <FieldArrayError control={form.control} name="lines" />
    </LineGrid>
  );
}
