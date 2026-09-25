import { NON_NEGATIVE_MONEY_PATTERN, formatDecimal } from "@accly/api/core/money";
import type { AppRouterClient } from "@accly/api/routers/index";
import { Button } from "@accly/ui/components/button";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@accly/ui/components/form";
import { Input } from "@accly/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";
import { useFieldArray, useFormContext, type UseFormReturn } from "react-hook-form";
import { z } from "zod";

import { FieldArrayError, LineGrid } from "@/components/document-form";
import { ItemSheet, type SavedItem } from "@/components/item-sheet";
import { LinkField } from "@/components/link-field";
import { incomeAccountOptions, postableAccounts } from "@/lib/accounts";
import { positiveAmount } from "@/lib/form-schema";
import { itemListOptions, type ItemListRow } from "@/lib/items";
import { useListState, type ListState } from "@/lib/list-state";
import { useCan } from "@/lib/membership";

/** The active item master, with the id lookup every line needs, built once. */
type ItemMaster = {
  rows: ItemListRow[];
  byId: Record<string, ItemListRow | undefined>;
};

// The editor reads the item master once and hands the result to every line;
// react-query keeps this selection while the cached list is unchanged.
function itemMaster(rows: ItemListRow[]): ItemMaster {
  const active = rows.filter((item) => item.active);
  const byId: Record<string, ItemListRow | undefined> = {};

  for (const item of active) byId[item.id] = item;

  return { rows: active, byId };
}

type IncomeAccount = Awaited<ReturnType<AppRouterClient["account"]["list"]>>[number];

const invoiceAccounts = (rows: IncomeAccount[]) => postableAccounts(rows, ["income"]);

export const lineSchema = z
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

      if (!positiveAmount.safeParse(line.amount).success) {
        context.addIssue({
          code: "custom",
          path: ["amount"],
          message: "Amount must be greater than zero",
        });
      }
    }
  });

type InvoiceLine = z.input<typeof lineSchema>;

type LinesForm = UseFormReturn<{ lines: InvoiceLine[] }>;

export const blankLine = (kind: InvoiceLine["kind"]): InvoiceLine => ({
  kind,
  itemId: null,
  accountId: null,
  quantity: "1",
  unitPrice: "",
  description: "",
  amount: "",
});

// A picked or newly created item fills the line's price; the operator may change it.
function setLineItem(form: LinesForm, index: number, item: SavedItem) {
  form.setValue(`lines.${index}.itemId`, item.id, { shouldDirty: true, shouldValidate: true });
  form.setValue(`lines.${index}.unitPrice`, formatDecimal(item.unitPricePaise), {
    shouldDirty: true,
  });
}

// Picker, description, quantity, price or amount, remove. Below `md` each cell stacks.
const ROW = "md:grid-cols-[minmax(0,3fr)_minmax(0,3fr)_5rem_8rem_1.5rem]";

function MoneyField({
  name,
  label,
}: {
  name: `lines.${number}.${"unitPrice" | "amount"}`;
  label: string;
}) {
  return (
    <RegisteredFormField
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel className="md:sr-only">{label}</FormLabel>
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
  );
}

function InvoiceLineRow({
  orgSlug,
  index,
  kind,
  items,
  accounts,
  canCreateItem,
  removeDisabled,
  remove,
}: {
  orgSlug: string;
  index: number;
  kind: InvoiceLine["kind"];
  items: ListState<ItemMaster>;
  accounts: ListState<IncomeAccount[]>;
  canCreateItem: boolean;
  removeDisabled: boolean;
  /** `useFieldArray`'s stable `remove`, so a row's props change only with its own index. */
  remove: (index: number) => void;
}) {
  const form = useFormContext<{ lines: InvoiceLine[] }>();
  const [createSeed, setCreateSeed] = useState<string | null>(null);
  const isItem = kind === "item";

  return (
    <fieldset
      className={`grid grid-cols-2 gap-2 border-b border-border py-2 last:border-b-0 md:items-start ${ROW}`}
    >
      <legend className="sr-only">Invoice line {index + 1}</legend>
      {isItem ? (
        <FormField
          control={form.control}
          name={`lines.${index}.itemId`}
          render={({ field, fieldState }) => (
            <FormItem className="col-span-2 md:col-span-1">
              <FormLabel className="md:sr-only">Item</FormLabel>
              <FormControl>
                <LinkField
                  items={items.data?.rows}
                  query={items}
                  noun="items"
                  getKey={(item) => item.id}
                  getLabel={(item) => item.name}
                  getCode={(item) => item.hsnSac ?? undefined}
                  value={(field.value ? items.data?.byId[field.value] : null) ?? null}
                  onSelect={(item) =>
                    item ? setLineItem(form, index, item) : field.onChange(null)
                  }
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
      ) : (
        <FormField
          control={form.control}
          name={`lines.${index}.accountId`}
          render={({ field, fieldState }) => (
            <FormItem className="col-span-2 md:col-span-1">
              <FormLabel className="md:sr-only">Income account</FormLabel>
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
      )}
      <RegisteredFormField
        name={`lines.${index}.description`}
        render={({ field }) => (
          <FormItem className="col-span-2 md:col-span-1">
            <FormLabel className="md:sr-only">
              {isItem ? "Description (optional)" : "Description"}
            </FormLabel>
            <FormControl>
              <Input {...field} required={!isItem} maxLength={200} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      {isItem ? (
        <RegisteredFormField
          name={`lines.${index}.quantity`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="md:sr-only">Quantity</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  required
                  inputMode="numeric"
                  pattern="[0-9]+"
                  className="text-right tabular-nums"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : (
        <span aria-hidden className="hidden md:block" />
      )}
      {isItem ? (
        <MoneyField name={`lines.${index}.unitPrice`} label="Unit price" />
      ) : (
        <MoneyField name={`lines.${index}.amount`} label="Amount" />
      )}
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className="col-span-2 justify-self-end md:col-span-1 md:mt-1"
        disabled={removeDisabled}
        aria-label={`Remove line ${index + 1}`}
        onClick={() => remove(index)}
      >
        <Trash2Icon />
      </Button>
      {createSeed === null ? null : (
        <ItemSheet
          orgSlug={orgSlug}
          seedName={createSeed}
          onClose={() => setCreateSeed(null)}
          onSaved={(item) => setLineItem(form, index, item)}
        />
      )}
    </fieldset>
  );
}

/** The invoice's line grid: one item or income-account line per row. */
export function InvoiceLines({ orgSlug }: { orgSlug: string }) {
  const form = useFormContext<{ lines: InvoiceLine[] }>();
  const linesField = useFieldArray({ control: form.control, name: "lines" });

  // One subscription per editor: every line reads these results through props.
  const items = useListState<ItemMaster>(
    useQuery({ ...itemListOptions(orgSlug), select: itemMaster }),
  );

  const accounts = useListState<IncomeAccount[]>(
    useQuery({ ...incomeAccountOptions(orgSlug), select: invoiceAccounts }),
  );

  const canCreateItem = useCan(orgSlug, { item: ["create"] });
  const full = linesField.fields.length >= 100;

  return (
    <LineGrid
      title="Lines"
      actions={
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={full}
            onClick={() => linesField.append(blankLine("item"))}
          >
            Add item
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={full}
            onClick={() => linesField.append(blankLine("account"))}
          >
            Add account
          </Button>
        </div>
      }
    >
      <div className={`hidden gap-2 text-muted-foreground md:grid ${ROW}`}>
        <span>Item or account</span>
        <span>Description</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Price</span>
        <span aria-hidden />
      </div>
      <div>
        {linesField.fields.map((line, index) => (
          <InvoiceLineRow
            key={line.id}
            orgSlug={orgSlug}
            index={index}
            kind={line.kind}
            items={items}
            accounts={accounts}
            canCreateItem={canCreateItem}
            removeDisabled={linesField.fields.length === 1}
            remove={linesField.remove}
          />
        ))}
      </div>
      <FieldArrayError control={form.control} name="lines" />
    </LineGrid>
  );
}
