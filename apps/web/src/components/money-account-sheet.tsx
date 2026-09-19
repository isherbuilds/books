import { MONEY_KINDS, type MoneyKind } from "@accly/db/schema/money-kinds";
import { shortName } from "@accly/api/lib/schemas";
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
import { SheetBody, SheetFooter } from "@accly/ui/components/sheet";
import { SubmitButton } from "@accly/ui/components/submit-button";
import { ToggleGroup, ToggleGroupItem } from "@accly/ui/components/toggle-group";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import { useZodForm } from "@/hooks/use-zod-form";
import { FormSheet } from "@/components/form-sheet";
import { orpc } from "@/lib/orpc";
import { errorMessage } from "@/lib/orpc-error";

const KIND_LABELS: Record<MoneyKind, string> = { cash: "Cash", bank: "Bank account" };

const accountSchema = z.object({
  kind: z.enum(MONEY_KINDS),
  name: shortName.max(120, "Keep the name under 120 characters"),
});

function MoneyAccountForm({ orgSlug, onClose }: { orgSlug: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const form = useZodForm(accountSchema, { defaultValues: { kind: "bank", name: "" } });

  const create = useMutation(
    orpc.account.create.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: orpc.account.moneyBalances.key({ input: { orgSlug } }),
        });
        toast.success("Account added");
        onClose();
      },
      onError: (error) => toast.error(errorMessage(error, "Could not add the account")),
    }),
  );

  const onSubmit = form.handleSubmit((values) => create.mutate({ orgSlug, ...values }));

  return (
    <Form {...form}>
      <form noValidate onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <fieldset disabled={create.isPending} className="contents">
          <SheetBody>
            <FormField
              control={form.control}
              name="kind"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Group</FormLabel>
                  <FormControl>
                    <ToggleGroup
                      value={[field.value]}
                      onValueChange={(next) => {
                        const kind = MONEY_KINDS.find((each) => each === next[0]);

                        if (kind) field.onChange(kind);
                      }}
                      spacing={1}
                      variant="outline"
                      aria-label="Group"
                    >
                      {MONEY_KINDS.map((kind) => (
                        <ToggleGroupItem key={kind} value={kind}>
                          {KIND_LABELS[kind]}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </FormControl>
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
                  <FormDescription>For example “ICICI Bank - Savings”.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
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

/** Adds a cash box or bank account under its money group. */
export function MoneyAccountSheet({
  orgSlug,
  open,
  onClose,
}: {
  orgSlug: string;
  open: boolean;
  onClose: () => void;
}) {
  // Stay open while a save is in flight, so a refusal lands on a mounted form.
  const saving = useIsMutating({ mutationKey: orpc.account.create.mutationKey() }) > 0;

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      saving={saving}
      title="Add account"
      description="One account per cash box or bank account."
    >
      <MoneyAccountForm orgSlug={orgSlug} onClose={onClose} />
    </FormSheet>
  );
}
