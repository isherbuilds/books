import { shortName } from "@accly/api/lib/schemas";
import { Button } from "@accly/ui/components/button";
import {
  Form,
  FormControl,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@accly/ui/components/form";
import { Input } from "@accly/ui/components/input";
import { NativeSelect } from "@accly/ui/components/native-select";
import { SheetBody, SheetFooter } from "@accly/ui/components/sheet";
import { SubmitButton } from "@accly/ui/components/submit-button";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import { FormSheet } from "@/components/form-sheet";
import { useZodForm } from "@/hooks/use-zod-form";
import { invalidatePaymentMethods } from "@/lib/domain-invalidation";
import { groupMoneyAccounts, moneyBalanceOptions } from "@/lib/money-accounts";
import { orpc } from "@/lib/orpc";
import { applyOrpcFieldError } from "@/lib/orpc-error";

const methodSchema = z.object({
  name: shortName.max(120, "Keep the name under 120 characters"),
  accountId: z.string().min(1, "Choose where the money lands"),
});

function PaymentMethodForm({
  orgSlug,
  accountId,
  onClose,
}: {
  orgSlug: string;
  accountId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useZodForm(methodSchema, { defaultValues: { name: "", accountId } });

  // The Banks page's cache entry; only an active money account takes a new method.
  const groups = useQuery({
    ...moneyBalanceOptions(orgSlug),
    select: (rows) =>
      groupMoneyAccounts(rows).flatMap((group) => {
        const leaves = group.leaves.filter((account) => account.active);

        return leaves.length > 0 ? [{ ...group, leaves }] : [];
      }),
  });

  const create = useMutation(
    orpc.paymentMethod.create.mutationOptions({
      onSuccess: async () => {
        await invalidatePaymentMethods(queryClient, orgSlug);
        toast.success("Payment method added");
        onClose();
      },
      onError: (error) => {
        applyOrpcFieldError(form, error, { DUPLICATE: "name" }, "Could not add the payment method");
      },
    }),
  );

  const onSubmit = form.handleSubmit((values) => create.mutate({ orgSlug, ...values }));

  return (
    <Form {...form}>
      <form noValidate onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <fieldset disabled={create.isPending} className="contents">
          <SheetBody>
            <RegisteredFormField
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} required maxLength={120} placeholder="ICICI NEFT" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <RegisteredFormField
              name="accountId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Lands in</FormLabel>
                  <FormControl>
                    <NativeSelect {...field} required>
                      <option value="" disabled>
                        {groups.isError ? "Could not load accounts" : "Choose an account"}
                      </option>
                      {groups.data?.map((group) => (
                        <optgroup key={group.id} label={group.name}>
                          {group.leaves.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.code} · {account.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </NativeSelect>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton isSubmitting={create.isPending}>Add method</SubmitButton>
          </SheetFooter>
        </fieldset>
      </form>
    </Form>
  );
}

/** Adds a Payment Method that lands in one active cash or bank account. */
export function PaymentMethodSheet({
  orgSlug,
  open,
  accountId = "",
  onClose,
}: {
  orgSlug: string;
  open: boolean;
  /** The account chosen when the Sheet opens, such as one just added. */
  accountId?: string;
  onClose: () => void;
}) {
  // Stay open while a save is in flight, so a refusal lands on a mounted form.
  const saving = useIsMutating({ mutationKey: orpc.paymentMethod.create.mutationKey() }) > 0;

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      saving={saving}
      title="Add payment method"
      description="A method names one way money arrives and the account it lands in."
    >
      <PaymentMethodForm orgSlug={orgSlug} accountId={accountId} onClose={onClose} />
    </FormSheet>
  );
}
