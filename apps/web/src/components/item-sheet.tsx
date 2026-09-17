import { formatDecimal, NON_NEGATIVE_MONEY_PATTERN } from "@accly/api/core/money";
import { Button } from "@accly/ui/components/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@accly/ui/components/form";
import { Input } from "@accly/ui/components/input";
import { NativeSelect } from "@accly/ui/components/native-select";
import { SheetFooter } from "@accly/ui/components/sheet";
import { SubmitButton } from "@accly/ui/components/submit-button";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { FormSheet } from "@/components/form-sheet";
import { LinkField } from "@/components/link-field";
import { useZodForm } from "@/hooks/use-zod-form";
import { incomeAccountOptions } from "@/lib/accounts";
import { invalidateItems } from "@/lib/domain-invalidation";
import type { ItemListRow } from "@/lib/items";
import { orpc } from "@/lib/orpc";
import { applyOrpcFieldError, errorMessage, errorReason, hasErrorCode } from "@/lib/orpc-error";

const HSN_SAC_PATTERN = /^\d{4,8}$/;

const itemSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a name")
    .max(120, "Keep the name under 120 characters")
    .refine((value) => /[\p{L}\p{N}]/u.test(value), "Name must include a letter or number"),
  hsnSac: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || HSN_SAC_PATTERN.test(value),
      "Use a 4 to 8 digit HSN/SAC code",
    ),
  unit: z.string().trim().max(20, "Keep the unit under 20 characters"),
  unitPrice: z.string().regex(NON_NEGATIVE_MONEY_PATTERN, "Enter a valid amount"),
  incomeAccountId: z.string().min(1, "Choose an income account"),
  taxCode: z.string(),
});

type ItemFormValues = z.input<typeof itemSchema>;

export type SavedItem = Pick<ItemListRow, "id" | "name" | "hsnSac" | "unitPricePaise">;

function defaults(item: ItemListRow | undefined, seedName: string | undefined): ItemFormValues {
  return {
    name: item?.name ?? seedName ?? "",
    hsnSac: item?.hsnSac ?? "",
    unit: item?.unit ?? "",
    unitPrice: item ? formatDecimal(item.unitPricePaise) : "",
    incomeAccountId: item?.incomeAccountId ?? "",
    taxCode: item?.taxCode ?? "",
  };
}

function ItemForm({
  orgSlug,
  item,
  seedName,
  onClose,
  onSaved,
}: {
  orgSlug: string;
  item?: ItemListRow;
  seedName?: string;
  onClose: () => void;
  onSaved?: (item: SavedItem) => void;
}) {
  const queryClient = useQueryClient();
  const form = useZodForm(itemSchema, { defaultValues: defaults(item, seedName) });
  // Captured with the initial field values: a background refetch must not swap the token
  // under edits the user has not saved, or the server would accept stale fields.
  const [editToken] = useState(() => item?.updatedAt.toISOString() ?? null);

  const accounts = useQuery(incomeAccountOptions(orgSlug));
  const rates = useQuery(orpc.item.taxRates.queryOptions({ input: { orgSlug } }));
  const incomeAccountId = useWatch({ control: form.control, name: "incomeAccountId" });

  const selectedAccount = accounts.data?.find((account) => account.id === incomeAccountId) ?? null;

  const taxable = selectedAccount?.supplyClass === "taxable";
  const fallback = item ? "Could not save the item" : "Could not add the item";

  const handleError = (error: unknown) => {
    // A CONFLICT without a reason is a stale edit token: the row changed after the sheet opened.
    if (hasErrorCode(error, "CONFLICT") && errorReason(error) === undefined) {
      void invalidateItems(queryClient, orgSlug);
      toast.error(errorMessage(error, fallback));
      onClose();

      return;
    }

    applyOrpcFieldError(
      form,
      error,
      {
        ITEM_NAME_TAKEN: "name",
        INCOME_ACCOUNT_INVALID: "incomeAccountId",
        TAX_CODE_REQUIRED: "taxCode",
        TAX_CODE_NOT_ALLOWED: "taxCode",
        TAX_CODE_INVALID: "taxCode",
      },
      fallback,
    );
  };

  const create = useMutation(
    orpc.item.create.mutationOptions({
      onSuccess: async (created) => {
        await invalidateItems(queryClient, orgSlug);
        toast.success("Item added");
        onSaved?.(created);
        onClose();
      },
      onError: handleError,
    }),
  );

  const update = useMutation(
    orpc.item.update.mutationOptions({
      onSuccess: async () => {
        await invalidateItems(queryClient, orgSlug);
        toast.success("Item saved");
        onClose();
      },
      onError: handleError,
    }),
  );

  // The mobile list renders cards without the table's row menu, so archiving lives here.
  const setActive = useMutation(
    orpc.item.setActive.mutationOptions({
      onSuccess: async () => {
        await invalidateItems(queryClient, orgSlug);
        toast.success(item?.active ? "Item archived" : "Item restored");
        onClose();
      },
      onError: (error) => toast.error(errorMessage(error, "Could not update the item")),
    }),
  );

  const saving = create.isPending || update.isPending || setActive.isPending;

  const onSubmit = form.handleSubmit((values) => {
    // Sent as held: choosing a non-taxable account clears it, and the server owns the
    // taxable rule even before the account list has loaded.
    const fields = {
      name: values.name,
      hsnSac: values.hsnSac || undefined,
      unit: values.unit || undefined,
      unitPrice: values.unitPrice,
      incomeAccountId: values.incomeAccountId,
      taxCode: values.taxCode || undefined,
    };

    if (item) {
      if (editToken === null) throw new Error("Editing an item without a captured edit token");

      update.mutate({ orgSlug, itemId: item.id, updatedAt: editToken, ...fields });
    } else {
      create.mutate({ orgSlug, ...fields });
    }
  });

  return (
    <Form {...form}>
      <form noValidate onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <fieldset disabled={saving} className="contents">
          <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto p-4">
            <RegisteredFormField
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} required maxLength={120} placeholder="Consulting" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <RegisteredFormField
                name="hsnSac"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>HSN/SAC</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        inputMode="numeric"
                        pattern="[0-9]{4,8}"
                        maxLength={8}
                        placeholder="998313"
                        className="font-mono"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <RegisteredFormField
                name="unit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unit</FormLabel>
                    <FormControl>
                      <Input {...field} maxLength={20} placeholder="hour" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <RegisteredFormField
              name="unitPrice"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Unit price</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      required
                      inputMode="decimal"
                      autoComplete="off"
                      pattern={NON_NEGATIVE_MONEY_PATTERN.source}
                      placeholder="0.00"
                      className="tabular-nums"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="incomeAccountId"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>Income account</FormLabel>
                  <FormControl>
                    <LinkField
                      items={accounts.data}
                      query={accounts}
                      noun="income accounts"
                      getKey={(account) => account.id}
                      getLabel={(account) => account.name}
                      getCode={(account) => account.code}
                      value={selectedAccount}
                      onSelect={(account) => {
                        field.onChange(account?.id ?? "");

                        if (account?.supplyClass !== "taxable") {
                          form.setValue("taxCode", "", { shouldValidate: true });
                        }
                      }}
                      inputRef={field.ref}
                      placeholder="Choose an income account"
                      aria-invalid={fieldState.invalid}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {taxable ? (
              <FormField
                control={form.control}
                name="taxCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>GST rate</FormLabel>
                    <FormControl>
                      <NativeSelect {...field} required>
                        <option value="" disabled>
                          {rates.isPending
                            ? "Loading GST rates…"
                            : rates.isError
                              ? "Could not load GST rates"
                              : "Choose a GST rate"}
                        </option>
                        {rates.data?.map((rate) => (
                          <option key={rate.id} value={rate.code}>
                            {rate.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}
          </div>

          <SheetFooter>
            {item ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="mr-auto"
                onClick={() => setActive.mutate({ orgSlug, itemId: item.id, active: !item.active })}
              >
                {item.active ? "Archive" : "Restore"}
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton isSubmitting={saving}>{item ? "Save item" : "Add item"}</SubmitButton>
          </SheetFooter>
        </fieldset>
      </form>
    </Form>
  );
}

/** Mounted only while open; the caller's condition is the open state. */
export function ItemSheet({
  orgSlug,
  item,
  seedName,
  onClose,
  onSaved,
}: {
  orgSlug: string;
  item?: ItemListRow;
  seedName?: string;
  onClose: () => void;
  onSaved?: (item: SavedItem) => void;
}) {
  const saving =
    useIsMutating({ mutationKey: orpc.item.create.mutationKey() }) +
      useIsMutating({ mutationKey: orpc.item.update.mutationKey() }) >
    0;

  return (
    <FormSheet
      open
      onClose={onClose}
      saving={saving}
      title={item ? "Edit item" : "Add item"}
      description="Set the sales account, unit price, and GST treatment used on invoices."
    >
      <ItemForm
        orgSlug={orgSlug}
        item={item}
        seedName={seedName}
        onClose={onClose}
        onSaved={onSaved}
      />
    </FormSheet>
  );
}
