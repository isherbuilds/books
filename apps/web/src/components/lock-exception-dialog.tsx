import { reason } from "@accly/api/lib/schemas";
import { Button } from "@accly/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@accly/ui/components/dialog";
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
import { SubmitButton } from "@accly/ui/components/submit-button";
import { Textarea } from "@accly/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClientOnly } from "@tanstack/react-router";
import { useWatch, type FieldPath } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { LinkField } from "@/components/link-field";
import { useZodForm } from "@/hooks/use-zod-form";
import { invalidateLockState } from "@/lib/domain-invalidation";
import { orpc } from "@/lib/orpc";
import { applyOrpcFieldError, isRefusal } from "@/lib/orpc-error";
import { orgLocalToInstant, useOrgDateTime } from "@/lib/org-datetime";

// Expiry is a wall-clock time in the Organization's zone; the server judges
// "in the future" on its own clock and refuses `EXPIRY_PAST` onto the field.
type ExceptionFormValues = {
  userId: string;
  expiresAt: string;
  reason: string;
};

const SERVER_FIELDS = {
  MEMBER_INVALID: "userId",
  EXPIRY_PAST: "expiresAt",
} satisfies Record<string, FieldPath<ExceptionFormValues>>;

export function LockExceptionDialog({
  orgSlug,
  onClose,
}: {
  orgSlug: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { timeZone } = useOrgDateTime();

  const form = useZodForm(
    z.object({
      userId: z.string().min(1, "Choose a member"),
      expiresAt: z
        .string()
        .min(1, "Choose when the exception expires")
        .refine((value) => {
          if (!value) return true;

          try {
            orgLocalToInstant(value, timeZone);

            return true;
          } catch (error) {
            if (error instanceof RangeError) return false;

            throw error;
          }
        }, `Choose a local time that exists in ${timeZone}`),
      reason,
    }),
    { defaultValues: { userId: "", expiresAt: "", reason: "" } },
  );

  const userId = useWatch({ control: form.control, name: "userId" });
  const members = useQuery(orpc.member.options.queryOptions({ input: { orgSlug } }));
  const selectedMember = members.data?.find((member) => member.userId === userId) ?? null;

  const grant = useMutation(
    orpc.lock.grantException.mutationOptions({
      onSuccess: async () => {
        await invalidateLockState(queryClient, orgSlug);
        toast.success("Exception granted");
        onClose();
      },
      onError: async (error) => {
        // Retrying could grant a second active exception, and revoking one leaves the
        // other in force; the list shows whether it went through.
        if (!isRefusal(error)) {
          onClose();
          await invalidateLockState(queryClient, orgSlug);
          toast.error("The result is uncertain. Check the exceptions before granting it again.");

          return;
        }

        applyOrpcFieldError(form, error, SERVER_FIELDS, "Could not grant the exception");
      },
    }),
  );

  const onSubmit = form.handleSubmit(({ expiresAt, ...values }) =>
    grant.mutate({
      orgSlug,
      ...values,
      expiresAt: orgLocalToInstant(expiresAt, timeZone).toISOString(),
    }),
  );

  return (
    <ClientOnly fallback={null}>
      <Dialog open onOpenChange={(next) => !next && !grant.isPending && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Grant exception</DialogTitle>
            <DialogDescription>
              Lets one member post on or before the books lock until the exception expires. The tax
              lock has no exceptions.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
              <fieldset disabled={grant.isPending} className="contents">
                <div className="flex flex-col gap-3">
                  <FormField
                    control={form.control}
                    name="userId"
                    render={({ field, fieldState }) => (
                      <FormItem>
                        <FormLabel>Member</FormLabel>
                        <FormControl>
                          <LinkField
                            items={members.data}
                            query={members}
                            noun="members"
                            getKey={(member) => member.userId}
                            getLabel={(member) => member.name}
                            getDescription={(member) => member.email}
                            value={selectedMember}
                            onSelect={(member) => field.onChange(member?.userId ?? "")}
                            inputRef={field.ref}
                            placeholder="Choose a member"
                            aria-invalid={fieldState.invalid}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <RegisteredFormField
                    name="expiresAt"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Expires</FormLabel>
                        <FormControl>
                          <Input {...field} type="datetime-local" step={60} required />
                        </FormControl>
                        <FormDescription>Local time in {timeZone}.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <RegisteredFormField
                    name="reason"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Reason</FormLabel>
                        <FormControl>
                          <Textarea {...field} required maxLength={500} rows={4} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={onClose}>
                    Cancel
                  </Button>
                  <SubmitButton isSubmitting={grant.isPending}>Grant exception</SubmitButton>
                </DialogFooter>
              </fieldset>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </ClientOnly>
  );
}
