import { LOCK_EXCEPTION_DAYS, reason } from "@accly/api/lib/schemas";
import { POSTING_GRANTS, authorize, parseRoles } from "@accly/auth/access";
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@accly/ui/components/form";
import { SubmitButton } from "@accly/ui/components/submit-button";
import { Textarea } from "@accly/ui/components/textarea";
import { ToggleGroup, ToggleGroupItem } from "@accly/ui/components/toggle-group";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClientOnly } from "@tanstack/react-router";
import { useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { LinkField } from "@/components/link-field";
import { useZodForm } from "@/hooks/use-zod-form";
import { invalidateLockState } from "@/lib/domain-invalidation";
import { orpc } from "@/lib/orpc";
import { applyOrpcFieldError, handleWriteError, type ServerFields } from "@/lib/orpc-error";

type ExceptionFormValues = {
  userId: string;
  days: (typeof LOCK_EXCEPTION_DAYS)[number];
  reason: string;
};

const SERVER_FIELDS = {
  MEMBER_INVALID: "userId",
  EXCEPTION_ACTIVE: "userId",
} satisfies ServerFields<ExceptionFormValues>;

export function LockExceptionDialog({
  orgSlug,
  onClose,
}: {
  orgSlug: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const form = useZodForm(
    z.object({
      userId: z.string().min(1, "Choose a member"),
      days: z.literal(LOCK_EXCEPTION_DAYS),
      reason,
    }),
    { defaultValues: { userId: "", days: 7, reason: "" } },
  );

  const userId = useWatch({ control: form.control, name: "userId" });

  // Only members who can post anything need an exception.
  const members = useQuery(
    orpc.member.options.queryOptions({
      input: { orgSlug },
      select: (rows) =>
        rows.filter((member) => {
          const roles = parseRoles(member.role);

          return POSTING_GRANTS.some((permission) => authorize(roles, permission));
        }),
    }),
  );

  const selectedMember = members.data?.find((member) => member.userId === userId) ?? null;

  const grant = useMutation(
    orpc.lock.grantException.mutationOptions({
      onSuccess: async () => {
        await invalidateLockState(queryClient, orgSlug);
        toast.success("Exception granted");
        onClose();
      },
      // An uncertain result must be checked against the refreshed active list.
      onError: (error) =>
        handleWriteError(error, {
          settle: () => {
            onClose();

            return invalidateLockState(queryClient, orgSlug);
          },
          fallback: "Could not grant the exception",
          uncertain: "The result is uncertain. Check the exceptions before granting it again.",
          refuse: () =>
            applyOrpcFieldError(form, error, SERVER_FIELDS, "Could not grant the exception"),
        }),
    }),
  );

  const onSubmit = form.handleSubmit((values) => grant.mutate({ orgSlug, ...values }));

  return (
    <ClientOnly fallback={null}>
      <Dialog open onOpenChange={(next) => !next && !grant.isPending && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Grant exception</DialogTitle>
            <DialogDescription>
              For a short time, this member can post or cancel documents dated on or before the
              books lock. The tax lock always stays closed.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
              <fieldset disabled={grant.isPending} className="contents">
                <div className="flex flex-col gap-3">
                  <FormField
                    control={form.control}
                    name="userId"
                    render={({ field }) => (
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
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="days"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>For how long</FormLabel>
                        <FormControl>
                          <ToggleGroup
                            value={[String(field.value)]}
                            onValueChange={(next) => {
                              const days = LOCK_EXCEPTION_DAYS.find(
                                (option) => String(option) === next[0],
                              );

                              if (days) field.onChange(days);
                            }}
                            spacing={1}
                            variant="outline"
                            aria-label="For how long"
                          >
                            {LOCK_EXCEPTION_DAYS.map((days) => (
                              <ToggleGroupItem key={days} value={String(days)}>
                                {days === 1 ? "1 day" : `${days} days`}
                              </ToggleGroupItem>
                            ))}
                          </ToggleGroup>
                        </FormControl>
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
