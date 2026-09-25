import { shortName } from "@accly/api/lib/schemas";
import { ACCOUNT_TYPES, SUPPLY_CLASSES } from "@accly/db/schema/accounts";
import { Button } from "@accly/ui/components/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@accly/ui/components/form";
import { Input } from "@accly/ui/components/input";
import { NativeSelect } from "@accly/ui/components/native-select";
import { SheetBody, SheetFooter } from "@accly/ui/components/sheet";
import { SubmitButton } from "@accly/ui/components/submit-button";
import { ToggleGroup, ToggleGroupItem } from "@accly/ui/components/toggle-group";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ACCOUNT_TYPE_LABELS, SUPPLY_CLASS_LABELS } from "@/components/account-columns";
import { FormSheet } from "@/components/form-sheet";
import { useZodForm } from "@/hooks/use-zod-form";
import type { AccountRow } from "@/lib/accounts";
import { invalidateAccountState } from "@/lib/domain-invalidation";
import { orpc } from "@/lib/orpc";
import { applyOrpcFieldError, errorMessage, errorReason } from "@/lib/orpc-error";

const accountName = shortName.max(120, "Keep the name under 120 characters");

const renameSchema = z.object({ name: accountName });

const createSchema = z.object({
  parent: z.string().min(1, "Choose where this account belongs."),
  name: accountName,
  supplyClass: z.enum(SUPPLY_CLASSES).optional(),
});

function RenameAccountForm({
  orgSlug,
  account,
  onClose,
}: {
  orgSlug: string;
  account: AccountRow;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useZodForm(renameSchema, { defaultValues: { name: account.name } });
  // Captured with the initial field values: a background refetch must not swap the token
  // under edits the user has not saved, or the server would accept a stale rename.
  const [editToken] = useState(() => account.updatedAt.toISOString());

  const update = useMutation(
    orpc.account.update.mutationOptions({
      onSuccess: async () => {
        await invalidateAccountState(queryClient, orgSlug);
        toast.success("Account renamed");
        onClose();
      },
      onError: (error) => {
        if (errorReason(error) === "STALE_RECORD") {
          void invalidateAccountState(queryClient, orgSlug);
          toast.error(errorMessage(error, "This account changed elsewhere. Reload and try again."));
          onClose();

          return;
        }

        applyOrpcFieldError(
          form,
          error,
          { ACCOUNT_NAME_TAKEN: "name" },
          "Could not rename the account",
        );
      },
    }),
  );

  const setActive = useMutation(
    orpc.account.setActive.mutationOptions({
      onSuccess: async () => {
        await invalidateAccountState(queryClient, orgSlug);
        toast.success(account.active ? "Account marked inactive" : "Account marked active");
        onClose();
      },
      onError: (error) => toast.error(errorMessage(error, "Could not update the account")),
    }),
  );

  const saving = update.isPending || setActive.isPending;

  const onSubmit = form.handleSubmit((values) =>
    update.mutate({ orgSlug, accountId: account.id, name: values.name, updatedAt: editToken }),
  );

  return (
    <Form {...form}>
      <form noValidate onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <fieldset disabled={saving} className="contents">
          <SheetBody className="gap-3">
            <RegisteredFormField
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} required maxLength={120} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SheetBody>

          <SheetFooter>
            {account.systemKey === null && !account.isGroup ? (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto"
                onClick={() =>
                  setActive.mutate({ orgSlug, accountId: account.id, active: !account.active })
                }
              >
                {account.active ? "Mark inactive" : "Mark active"}
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton isSubmitting={saving}>Save name</SubmitButton>
          </SheetFooter>
        </fieldset>
      </form>
    </Form>
  );
}

function CreateAccountForm({
  orgSlug,
  accounts,
  defaultParent,
  onCreated,
  onClose,
}: {
  orgSlug: string;
  accounts: AccountRow[];
  defaultParent: string;
  onCreated: (account: { id: string }) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const groups = accounts.filter((account) => account.active && account.isGroup);

  const form = useZodForm(createSchema, {
    defaultValues: { parent: defaultParent, name: "" },
  });

  const parent = useWatch({ control: form.control, name: "parent" });

  const rootType = ACCOUNT_TYPES.find((type) => type === parent);
  const selectedType = rootType ?? groups.find((account) => account.id === parent)?.type;

  const create = useMutation(
    orpc.account.create.mutationOptions({
      onSuccess: async (created) => {
        await invalidateAccountState(queryClient, orgSlug);
        toast.success("Account added");
        onCreated(created);
      },
      onError: (error) =>
        applyOrpcFieldError(
          form,
          error,
          {
            ACCOUNT_NAME_TAKEN: "name",
            ACCOUNT_PARENT_INVALID: "parent",
            SUPPLY_CLASS_REQUIRED: "supplyClass",
          },
          "Could not add the account",
        ),
    }),
  );

  // `parent` is watched, so `rootType` and `selectedType` describe the submitted value.
  const onSubmit = form.handleSubmit((values) => {
    create.mutate({
      orgSlug,
      name: values.name,
      parent: rootType ? { type: rootType } : { accountId: values.parent },
      supplyClass: selectedType === "income" ? values.supplyClass : undefined,
    });
  });

  return (
    <Form {...form}>
      <form noValidate onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <fieldset disabled={create.isPending} className="contents">
          <SheetBody className="gap-3">
            <FormField
              control={form.control}
              name="parent"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Under</FormLabel>
                  <FormControl>
                    <NativeSelect {...field} required>
                      <option value="" disabled>
                        Choose a parent ledger
                      </option>
                      {ACCOUNT_TYPES.map((type) => (
                        <optgroup key={type} label={ACCOUNT_TYPE_LABELS[type]}>
                          <option value={type}>Top level</option>
                          {groups
                            .filter((account) => account.type === type)
                            .map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.code} · {account.name}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </NativeSelect>
                  </FormControl>
                  <FormDescription>Codes are generated automatically.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <RegisteredFormField
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} required maxLength={120} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {selectedType === "income" ? (
              <FormField
                control={form.control}
                name="supplyClass"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>GST supply class</FormLabel>
                    <FormControl>
                      <ToggleGroup
                        value={field.value ? [field.value] : []}
                        onValueChange={(next) => field.onChange(next[0])}
                        spacing={1}
                        variant="outline"
                        aria-label="GST supply class"
                        className="flex-wrap"
                      >
                        {SUPPLY_CLASSES.map((value) => (
                          <ToggleGroupItem key={value} value={value}>
                            {SUPPLY_CLASS_LABELS[value]}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton isSubmitting={create.isPending}>Add account</SubmitButton>
          </SheetFooter>
        </fieldset>
      </form>
    </Form>
  );
}

export function AccountSheet({
  orgSlug,
  account,
  accounts,
  defaultParent = "",
  onCreated,
  onClose,
}: {
  orgSlug: string;
  account?: AccountRow;
  accounts: AccountRow[];
  /** The parent a new account starts under: an account type or a group id. */
  defaultParent?: string;
  /** Runs after a create instead of `onClose`, for a caller that continues setup. */
  onCreated?: (account: { id: string }) => void;
  onClose: () => void;
}) {
  const saving = useIsMutating({ mutationKey: orpc.account.key({ type: "mutation" }) }) > 0;

  return (
    <FormSheet
      open
      onClose={onClose}
      saving={saving}
      title={account ? "Rename account" : "Add account"}
      description={
        account
          ? `${account.code} · ${ACCOUNT_TYPE_LABELS[account.type]}`
          : "Place a new account under a root or parent ledger"
      }
    >
      {account ? (
        <RenameAccountForm orgSlug={orgSlug} account={account} onClose={onClose} />
      ) : (
        <CreateAccountForm
          orgSlug={orgSlug}
          accounts={accounts}
          defaultParent={defaultParent}
          onCreated={onCreated ?? onClose}
          onClose={onClose}
        />
      )}
    </FormSheet>
  );
}
