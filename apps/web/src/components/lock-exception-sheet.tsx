import { reason } from "@accly/api/lib/schemas";
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
import { Textarea } from "@accly/ui/components/textarea";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWatch, type FieldPath } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { FormSheet } from "@/components/form-sheet";
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

function LockExceptionForm({ orgSlug, onClose }: { orgSlug: string; onClose: () => void }) {
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
    <Form {...form}>
      <form noValidate onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <fieldset disabled={grant.isPending} className="contents">
          <SheetBody>
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
                    <Input {...field} type="datetime-local" required />
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
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton isSubmitting={grant.isPending}>Grant exception</SubmitButton>
          </SheetFooter>
        </fieldset>
      </form>
    </Form>
  );
}

export function LockExceptionSheet({ orgSlug, onClose }: { orgSlug: string; onClose: () => void }) {
  const saving = useIsMutating({ mutationKey: orpc.lock.grantException.mutationKey() }) > 0;

  return (
    <FormSheet
      open
      onClose={onClose}
      saving={saving}
      title="Grant exception"
      description="Lets one member post on or before the books lock until the exception expires. The tax lock has no exceptions."
    >
      <LockExceptionForm orgSlug={orgSlug} onClose={onClose} />
    </FormSheet>
  );
}
