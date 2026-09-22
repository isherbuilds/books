import { dateOnly, reason } from "@accly/api/lib/schemas";
import type { LockKind } from "@accly/db/schema/period-locks";
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
import { SheetBody, SheetFooter } from "@accly/ui/components/sheet";
import { SubmitButton } from "@accly/ui/components/submit-button";
import { Textarea } from "@accly/ui/components/textarea";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import { FormSheet } from "@/components/form-sheet";
import { useZodForm } from "@/hooks/use-zod-form";
import { formatBusinessDate } from "@accly/api/lib/business-date";
import { invalidateLockState } from "@/lib/domain-invalidation";
import { LOCK_KIND_LABELS } from "@/lib/locks";
import { orpc } from "@/lib/orpc";
import { errorMessage, hasErrorCode, isRefusal } from "@/lib/orpc-error";

const lockSchema = z.object({
  lockedThrough: z.union([z.literal(""), dateOnly]),
  expectedLockedThrough: dateOnly.nullable(),
  reason,
});

function LockForm({
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

  const form = useZodForm(lockSchema, {
    defaultValues: {
      lockedThrough: current?.lockedThrough ?? "",
      expectedLockedThrough: current?.lockedThrough ?? null,
      reason: "",
    },
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
      onError: async (error) => {
        // A lost response or conflict makes this form's loaded lock snapshot stale.
        if (!isRefusal(error) || hasErrorCode(error, "CONFLICT")) {
          onClose();
          await invalidateLockState(queryClient, orgSlug);
          toast.error(
            isRefusal(error)
              ? errorMessage(error, `Could not update the ${label.toLowerCase()} lock`)
              : "The result is uncertain. Check the lock before setting it again.",
          );

          return;
        }

        toast.error(errorMessage(error, `Could not update the ${label.toLowerCase()} lock`));
      },
    }),
  );

  const onSubmit = form.handleSubmit(
    ({ lockedThrough, expectedLockedThrough, reason: lockReason }) =>
      setLock.mutate({
        orgSlug,
        kind,
        lockedThrough: lockedThrough || null,
        expectedLockedThrough,
        reason: lockReason,
      }),
  );

  return (
    <Form {...form}>
      <form noValidate onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <fieldset disabled={setLock.isPending} className="contents">
          <SheetBody>
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
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton isSubmitting={setLock.isPending}>Save lock</SubmitButton>
          </SheetFooter>
        </fieldset>
      </form>
    </Form>
  );
}

export function LockSheet({
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
  const saving = useIsMutating({ mutationKey: orpc.lock.set.mutationKey() }) > 0;
  const label = LOCK_KIND_LABELS[kind];

  return (
    <FormSheet
      open
      onClose={onClose}
      saving={saving}
      title={`Lock ${label}`}
      description="Posting on or before this date is refused. Clear the date to unlock."
    >
      <LockForm
        key={`${orgSlug}:${kind}`}
        orgSlug={orgSlug}
        kind={kind}
        current={current}
        onClose={onClose}
      />
    </FormSheet>
  );
}
