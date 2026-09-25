import { NON_NEGATIVE_MONEY_PATTERN } from "@accly/api/core/money";
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
import { ToggleGroup, ToggleGroupItem } from "@accly/ui/components/toggle-group";
import { useQuery } from "@tanstack/react-query";
import { useFormContext, Watch } from "react-hook-form";

import { FieldArrayError, LineGrid } from "@/components/document-form";
import { LinkField } from "@/components/link-field";
import { accountListOptions, postableAccounts, type AccountListRow } from "@/lib/accounts";
import { useListState, type ListState } from "@/lib/list-state";

type Adjustment = { kind: "fee" | "writeOff" | "tds"; accountId: string | null; amount: string };

type AdjustmentForm = { adjustments: Adjustment[] };

// Module scope, so the selection holds while the cached chart is unchanged.
const expenseAccounts = (rows: AccountListRow[]) => postableAccounts(rows, ["expense"]);

function AdjustmentRow({
  index,
  accounts,
  remove,
}: {
  index: number;
  accounts: ListState<AccountListRow[]>;
  /** `useFieldArray`'s stable `remove`, so a row's props change only with its own index. */
  remove: (index: number) => void;
}) {
  const form = useFormContext<AdjustmentForm>();

  return (
    <div className="grid gap-2 border-b border-border pb-3 last:border-0">
      <FormField
        control={form.control}
        name={`adjustments.${index}.kind`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Kind</FormLabel>
            <FormControl>
              <ToggleGroup
                value={[field.value]}
                spacing={1}
                variant="outline"
                aria-label={`Adjustment ${index + 1} kind`}
                onValueChange={(next) => {
                  if (next[0] === "fee" || next[0] === "writeOff" || next[0] === "tds") {
                    field.onChange(next[0]);
                    form.setValue(`adjustments.${index}.accountId`, null);
                  }
                }}
              >
                <ToggleGroupItem value="fee">Fee</ToggleGroupItem>
                <ToggleGroupItem value="writeOff">Write-off</ToggleGroupItem>
                <ToggleGroupItem value="tds">TDS</ToggleGroupItem>
              </ToggleGroup>
            </FormControl>
          </FormItem>
        )}
      />
      <div className="grid gap-2 sm:grid-cols-[1fr_7rem_auto]">
        <Watch
          control={form.control}
          name={`adjustments.${index}.kind`}
          render={(kind) =>
            kind === "tds" ? (
              <span className="self-end text-muted-foreground">TDS receivable</span>
            ) : (
              <FormField
                control={form.control}
                name={`adjustments.${index}.accountId`}
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Expense account</FormLabel>
                    <FormControl>
                      <LinkField
                        items={accounts.data}
                        query={accounts}
                        noun="expense accounts"
                        getKey={(account) => account.id}
                        getLabel={(account) => account.name}
                        getCode={(account) => account.code}
                        value={accounts.data?.find((account) => account.id === field.value) ?? null}
                        onSelect={(account) => field.onChange(account?.id ?? null)}
                        inputRef={field.ref}
                        placeholder="Choose account"
                        aria-invalid={fieldState.invalid}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )
          }
        />
        <RegisteredFormField
          name={`adjustments.${index}.amount`}
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
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="self-end"
          aria-label={`Remove adjustment ${index + 1}`}
          onClick={() => remove(index)}
        >
          Remove
        </Button>
      </div>
    </div>
  );
}

/** A receipt's fee, write-off, and TDS adjustments; the host owns the field array so settlement changes clear it. */
export function ReceiptAdjustments({
  orgSlug,
  adjustmentFields,
}: {
  orgSlug: string;
  adjustmentFields: {
    fields: { id: string }[];
    append: (adjustment: Adjustment) => void;
    remove: (index: number) => void;
  };
}) {
  const form = useFormContext<AdjustmentForm>();

  const accounts = useListState<AccountListRow[]>(
    useQuery({ ...accountListOptions(orgSlug), select: expenseAccounts }),
  );

  return (
    <LineGrid
      title="Adjustments"
      actions={
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={adjustmentFields.fields.length >= 5}
          onClick={() => adjustmentFields.append({ kind: "fee", accountId: null, amount: "" })}
        >
          Add adjustment
        </Button>
      }
    >
      {adjustmentFields.fields.map((adjustment, index) => (
        <AdjustmentRow
          key={adjustment.id}
          index={index}
          accounts={accounts}
          remove={adjustmentFields.remove}
        />
      ))}
      <FieldArrayError control={form.control} name="adjustments" />
    </LineGrid>
  );
}
