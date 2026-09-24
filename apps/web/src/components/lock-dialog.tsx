import { dateOnly, reason } from "@accly/api/lib/schemas";
import { formatBusinessDate } from "@accly/api/lib/business-date";
import type { LockKind } from "@accly/db/schema/period-locks";
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
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@accly/ui/components/form";
import { Input } from "@accly/ui/components/input";
import { SubmitButton } from "@accly/ui/components/submit-button";
import { Textarea } from "@accly/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ClientOnly } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { useZodForm } from "@/hooks/use-zod-form";
import { invalidateLockState } from "@/lib/domain-invalidation";
import { LOCK_KIND_LABELS } from "@/lib/locks";
import { orpc } from "@/lib/orpc";
import { handleWriteError } from "@/lib/orpc-error";

const lockSchema = z.object({
  lockedThrough: z.union([z.literal(""), dateOnly]),
  reason,
});

export function LockDialog({
  orgSlug,
  kind,
  current,
  onClose,
}: {
  orgSlug: string;
  kind: LockKind;
  current: { lockedThrough: string | null } | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const label = LOCK_KIND_LABELS[kind];
  // The lock the operator opened; a background refetch must not move the CAS token.
  const [expectedLockedThrough] = useState(current?.lockedThrough ?? null);

  const form = useZodForm(lockSchema, {
    defaultValues: { lockedThrough: current?.lockedThrough ?? "", reason: "" },
  });

  const setLock = useMutation(
    orpc.lock.set.mutationOptions({
      onSuccess: async ({ lockedThrough }) => {
        await invalidateLockState(queryClient, orgSlug);
        toast.success(
          lockedThrough
            ? `${label} locked through ${formatBusinessDate(lockedThrough)}`
            : `${label} unlocked`,
        );
        onClose();
      },
      onError: (error) =>
        handleWriteError(error, {
          settle: () => {
            onClose();

            return invalidateLockState(queryClient, orgSlug);
          },
          fallback: `Could not update the ${label.toLowerCase()} lock`,
          uncertain: "The result is uncertain. Check the lock before setting it again.",
        }),
    }),
  );

  const onSubmit = form.handleSubmit(({ lockedThrough, reason: lockReason }) =>
    setLock.mutate({
      orgSlug,
      kind,
      lockedThrough: lockedThrough || null,
      expectedLockedThrough,
      reason: lockReason,
    }),
  );

  return (
    <ClientOnly fallback={null}>
      <Dialog open onOpenChange={(next) => !next && !setLock.isPending && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`Lock ${label}`}</DialogTitle>
            <DialogDescription>
              Posting on or before this date is refused. Clear the date to unlock.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
              <fieldset disabled={setLock.isPending} className="contents">
                <div className="flex flex-col gap-3">
                  <RegisteredFormField
                    name="lockedThrough"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Locked through</FormLabel>
                        <FormControl>
                          <Input {...field} type="date" />
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
                  <SubmitButton isSubmitting={setLock.isPending}>Save lock</SubmitButton>
                </DialogFooter>
              </fieldset>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </ClientOnly>
  );
}
