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
import { useFormContext } from "react-hook-form";

import { LineGrid } from "@/components/document-form";
import { LinkField } from "@/components/link-field";
import { accountListOptions, postableAccounts, type AccountListRow } from "@/lib/accounts";
import { useListState, type ListState } from "@/lib/list-state";

type WriteOff = { accountId: string | null; amount: string };

type WriteOffForm = { writeOffs: WriteOff[] };

// Module scope, so the selection holds while the cached chart is unchanged.
const writeOffAccounts = (rows: AccountListRow[]) => postableAccounts(rows, ["expense", "income"]);

function WriteOffRow({
  index,
  accounts,
  remove,
}: {
  index: number;
  accounts: ListState<AccountListRow[]>;
  /** `useFieldArray`'s stable `remove`, so a row's props change only with its own index. */
  remove: (index: number) => void;
}) {
  const form = useFormContext<WriteOffForm>();

  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_7rem_auto]">
      <FormField
        control={form.control}
        name={`writeOffs.${index}.accountId`}
        render={({ field, fieldState }) => (
          <FormItem>
            <FormLabel>Write-off account</FormLabel>
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
                inputRef={field.ref}
                placeholder="Choose write-off account"
                aria-invalid={fieldState.invalid}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <RegisteredFormField
        name={`writeOffs.${index}.amount`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Amount</FormLabel>
            <FormControl>
              <Input {...field} inputMode="decimal" placeholder="0.00" className="tabular-nums" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="self-end"
        onClick={() => remove(index)}
      >
        Remove
      </Button>
    </div>
  );
}

/** A bill payment's write-offs; the host owns the field array so settlement changes clear it. */
export function PaymentWriteOffs({
  orgSlug,
  writeOffFields,
}: {
  orgSlug: string;
  writeOffFields: {
    fields: { id: string }[];
    append: (writeOff: WriteOff) => void;
    remove: (index: number) => void;
  };
}) {
  const accounts = useListState<AccountListRow[]>(
    useQuery({ ...accountListOptions(orgSlug), select: writeOffAccounts }),
  );

  return (
    <LineGrid
      title="Write-offs"
      actions={
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={writeOffFields.fields.length >= 5}
          onClick={() => writeOffFields.append({ accountId: null, amount: "" })}
        >
          Add write-off
        </Button>
      }
    >
      {writeOffFields.fields.map((writeOff, index) => (
        <WriteOffRow
          key={writeOff.id}
          index={index}
          accounts={accounts}
          remove={writeOffFields.remove}
        />
      ))}
    </LineGrid>
  );
}
