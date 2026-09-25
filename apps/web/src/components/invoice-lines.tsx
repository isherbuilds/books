import { NON_NEGATIVE_MONEY_PATTERN, formatDecimal } from "@accly/api/core/money";
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
  });

type InvoiceLine = z.input<typeof lineSchema>;

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
  });
}

// Picker, description, quantity, price, remove. Below `md` each cell stacks.
const ROW = "md:grid-cols-[minmax(0,3fr)_minmax(0,3fr)_5rem_8rem_1.5rem]";

function InvoiceLineRow({
  orgSlug,
  index,
  items,
  canCreateItem,
  removeDisabled,
  remove,
}: {
  orgSlug: string;
  index: number;
  items: ListState<ItemMaster>;
  canCreateItem: boolean;
  removeDisabled: boolean;
  /** `useFieldArray`'s stable `remove`, so a row's props change only with its own index. */
  remove: (index: number) => void;
}) {
  const form = useFormContext<{ lines: InvoiceLine[] }>();
  const [createSeed, setCreateSeed] = useState<string | null>(null);

  return (
    <fieldset
      className={`grid grid-cols-2 gap-2 border-b border-border py-2 last:border-b-0 md:items-start ${ROW}`}
    >
      <legend className="sr-only">Invoice line {index + 1}</legend>
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
      <RegisteredFormField
        name={`lines.${index}.unitPrice`}
        render={({ field }) => (
          <FormItem>
            <FormLabel className="md:sr-only">Unit price</FormLabel>
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

/** The invoice's line grid: one Item line per row. */
export function InvoiceLines({ orgSlug }: { orgSlug: string }) {
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
            items={items}
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
