import { Button } from "@accly/ui/components/button";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@accly/ui/components/form";

import { ToggleGroup, ToggleGroupItem } from "@accly/ui/components/toggle-group";
import { skipToken, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useFormContext, Watch } from "react-hook-form";

import { AmountInput } from "@/components/amount-input";
import { FieldArrayError, LineGrid } from "@/components/document-form";
import { LinkField } from "@/components/link-field";
import { accountListOptions, postableAccounts, type AccountListRow } from "@/lib/accounts";
import { useListState, type ListState } from "@/lib/list-state";
import { orpc } from "@/lib/orpc";

type Adjustment = {
  kind: "fee" | "writeOff" | "tds";
  accountId: string | null;
  tdsSectionId: string | null;
  amount: string;
};

type TdsSection = { id: string; code: string; description: string; rateBasisPoints: number };

type AdjustmentForm = { adjustments: Adjustment[] };

// Module scope, so the selection holds while the cached chart is unchanged.
const expenseAccounts = (rows: AccountListRow[]) => postableAccounts(rows, ["expense"]);

function AdjustmentRow({
  index,
  accounts,
  sections,
  remove,
}: {
  index: number;
  accounts: ListState<AccountListRow[]>;
  sections: ListState<TdsSection[]>;
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
                    form.setValue(`adjustments.${index}.tdsSectionId`, null);
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
              <FormField
                control={form.control}
                name={`adjustments.${index}.tdsSectionId`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>TDS section</FormLabel>
                    <FormControl>
                      <LinkField
                        items={sections.data}
                        query={sections}
                        noun="TDS sections"
                        getKey={(section) => section.id}
                        getLabel={(section) => `${section.code} · ${section.description}`}
                        getCode={(section) => section.code}
                        value={sections.data?.find((section) => section.id === field.value) ?? null}
                        onSelect={(section) => field.onChange(section?.id ?? null)}
                        inputRef={field.ref}
                        placeholder="Choose a TDS section"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <FormField
                control={form.control}
                name={`adjustments.${index}.accountId`}
                render={({ field }) => (
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
                <AmountInput symbol {...field} required />
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
  documentDate,
  adjustmentFields,
}: {
  orgSlug: string;
  documentDate: string;
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

  const sections = useListState<TdsSection[]>(
    useQuery(
      orpc.payment.tdsSections.queryOptions({
        input: z.iso.date().safeParse(documentDate).success
          ? { orgSlug, date: documentDate }
          : skipToken,
      }),
    ),
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
          onClick={() =>
            adjustmentFields.append({
              kind: "fee",
              accountId: null,
              tdsSectionId: null,
              amount: "",
            })
          }
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
          sections={sections}
          remove={adjustmentFields.remove}
        />
      ))}
      <FieldArrayError control={form.control} name="adjustments" />
    </LineGrid>
  );
}
