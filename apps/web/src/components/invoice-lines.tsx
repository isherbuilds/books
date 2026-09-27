import {
  NON_NEGATIVE_MONEY_PATTERN,
  belowBasisPoints,
  formatDecimal,
  formatMoney,
  parseMoney,
} from "@accly/api/core/money";
import { MAX_INVOICE_QUANTITY } from "@accly/api/lib/schemas";
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
import { useFieldArray, useFormContext, useWatch, type UseFormReturn } from "react-hook-form";
import { z } from "zod";

import { AmountInput } from "@/components/amount-input";
import { FieldArrayError, LineGrid } from "@/components/document-form";
import { ItemSheet, type SavedItem } from "@/components/item-sheet";
import { LinkField } from "@/components/link-field";
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

function validQuantity(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;

  const quantity = Number(value);

  return Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= MAX_INVOICE_QUANTITY;
}

// Every line is an Item; a one-off charge uses a generic Item (such as "Professional
// fees") with its own description and price (accounting-core call 5).
export const lineSchema = z
  .object({
    itemId: z.string().nullable(),
    quantity: z.string(),
    unitPrice: z.string(),
    description: z.string().trim().max(200, "Description must be 200 characters or fewer"),
  })
  .superRefine((line, context) => {
    if (!line.itemId)
      context.addIssue({ code: "custom", path: ["itemId"], message: "Choose an item" });

    if (!validQuantity(line.quantity)) {
      context.addIssue({
        code: "custom",
        path: ["quantity"],
        message: "Quantity must be from 1 to 1,000,000",
      });
    }

    if (!NON_NEGATIVE_MONEY_PATTERN.test(line.unitPrice)) {
      context.addIssue({ code: "custom", path: ["unitPrice"], message: "Enter a valid price" });
    }
  });

type InvoiceLine = z.input<typeof lineSchema>;

export type InvoiceLineQuote = {
  rateBasisPoints: number | null;
  grossPaise: bigint;
};

type LinesForm = UseFormReturn<{ lines: InvoiceLine[] }>;

export const blankLine = (): InvoiceLine => ({
  itemId: null,
  quantity: "1",
  unitPrice: "",
  description: "",
});

// A picked or newly created item fills the line's price; the operator may change it.
function setLineItem(form: LinesForm, index: number, item: SavedItem) {
  form.setValue(`lines.${index}.itemId`, item.id, { shouldDirty: true, shouldValidate: true });
  form.setValue(`lines.${index}.unitPrice`, formatDecimal(item.unitPricePaise), {
    shouldDirty: true,
    shouldValidate: true,
  });
}

/** A line's quantity times rate, or null while either is incomplete. */
export function lineAmountPaise(line: { quantity: string; unitPrice: string }): bigint | null {
  if (!validQuantity(line.quantity) || !NON_NEGATIVE_MONEY_PATTERN.test(line.unitPrice)) return null;

  return BigInt(line.quantity) * parseMoney(line.unitPrice);
}

const percent = (basisPoints: number) => `${basisPoints / 100}%`;

// Item (with its description and tax facts under it), quantity, rate, amount, remove.
// Below `md` each cell stacks.
const ROW = "md:grid-cols-[minmax(0,1fr)_5rem_8rem_16ch_1.5rem]";

// Only an Item with an MRP shows this, so general items look as before. MRP is display:
// the rate is the transaction value, and selling above MRP is a warning, not a refusal.
function MrpHint({
  mrpPaise,
  quantity,
  grossPaise,
}: {
  mrpPaise: bigint;
  quantity: string;
  grossPaise?: bigint;
}) {
  const lineMrpPaise = validQuantity(quantity) ? BigInt(quantity) * mrpPaise : null;

  if (grossPaise === undefined || lineMrpPaise === null) {
    return <p className="text-right text-muted-foreground">MRP {formatMoney(mrpPaise)}</p>;
  }

  if (grossPaise > lineMrpPaise) {
    return <p className="text-right text-destructive">Above MRP {formatMoney(mrpPaise)}</p>;
  }

  const offBasisPoints = belowBasisPoints(lineMrpPaise, grossPaise);

  return (
    <p className="text-right text-muted-foreground tabular-nums">
      MRP {formatMoney(mrpPaise)}
      {offBasisPoints > 0 ? ` · ${percent(offBasisPoints)} off` : ""}
    </p>
  );
}

function InvoiceLineRow({
  orgSlug,
  index,
  items,
  canCreateItem,
  removeDisabled,
  remove,
  quote,
}: {
  orgSlug: string;
  index: number;
  items: ListState<ItemMaster>;
  /** The current server-resolved line; undefined while its quote is absent or stale. */
  quote: InvoiceLineQuote | undefined;
  canCreateItem: boolean;
  removeDisabled: boolean;
  /** `useFieldArray`'s stable `remove`, so a row's props change only with its own index. */
  remove: (index: number) => void;
}) {
  const form = useFormContext<{ lines: InvoiceLine[] }>();
  const [createSeed, setCreateSeed] = useState<string | null>(null);
  const line = useWatch({ control: form.control, name: `lines.${index}` });
  const item = line.itemId ? items.data?.byId[line.itemId] : undefined;
  const amount = lineAmountPaise(line);

  const facts = [
    item?.hsnSac ? `HSN/SAC ${item.hsnSac}` : null,
    quote?.rateBasisPoints == null ? null : `GST ${percent(quote.rateBasisPoints)}`,
    item?.unit ? `per ${item.unit}` : null,
  ].filter(Boolean);

  return (
    <fieldset
      className={`grid grid-cols-2 gap-2 border-b border-border py-2 last:border-b-0 md:items-start ${ROW}`}
    >
      <legend className="sr-only">Invoice line {index + 1}</legend>
      <div className="col-span-2 grid gap-1 md:col-span-1">
        <FormField
          control={form.control}
          name={`lines.${index}.itemId`}
          render={({ field }) => (
            <FormItem>
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
              <FormLabel className="sr-only">Description</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  maxLength={200}
                  placeholder="Description (optional)"
                  className="h-7 text-muted-foreground focus-visible:text-foreground"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {facts.length > 0 ? <p className="text-muted-foreground">{facts.join(" · ")}</p> : null}
      </div>
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
                maxLength={String(MAX_INVOICE_QUANTITY).length}
                className="text-right tabular-nums"
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
            <FormLabel className="md:sr-only">Rate</FormLabel>
            <FormControl>
              <AmountInput {...field} required />
            </FormControl>
            <FormMessage />
            {item?.mrpPaise != null ? (
              <MrpHint
                mrpPaise={item.mrpPaise}
                quantity={line.quantity}
                grossPaise={quote?.grossPaise}
              />
            ) : null}
          </FormItem>
        )}
      />
      <p className="flex h-8 items-center gap-2 tabular-nums md:justify-end md:self-start">
        <span className="text-muted-foreground md:sr-only">Amount</span>
        {amount === null ? "—" : formatMoney(amount)}
      </p>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className="self-center justify-self-end md:mt-1 md:self-start"
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

/** The invoice's line grid: one Item line per row, with current server-resolved quote data. */
export function InvoiceLines({
  orgSlug,
  quotes,
}: {
  orgSlug: string;
  quotes: ReadonlyArray<InvoiceLineQuote | undefined>;
}) {
  const form = useFormContext<{ lines: InvoiceLine[] }>();
  const linesField = useFieldArray({ control: form.control, name: "lines" });

  // One subscription per editor: every line reads these results through props.
  const items = useListState<ItemMaster>(
    useQuery({ ...itemListOptions(orgSlug), select: itemMaster }),
  );

  const canCreateItem = useCan(orgSlug, { item: ["create"] });
  const full = linesField.fields.length >= 100;

  return (
    <LineGrid
      title="Lines"
      actions={
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={full}
          onClick={() => linesField.append(blankLine())}
        >
          Add item
        </Button>
      }
    >
      <div className={`hidden gap-2 text-muted-foreground md:grid ${ROW}`}>
        <span>Item</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Rate</span>
        <span className="text-right">Amount</span>
        <span aria-hidden />
      </div>
      <div>
        {linesField.fields.map((line, index) => (
          <InvoiceLineRow
            key={line.id}
            orgSlug={orgSlug}
            index={index}
            items={items}
            canCreateItem={canCreateItem}
            removeDisabled={linesField.fields.length === 1}
            remove={linesField.remove}
            quote={quotes[index]}
          />
        ))}
      </div>
      <FieldArrayError control={form.control} name="lines" />
    </LineGrid>
  );
}
