import { useIsMutating } from "@tanstack/react-query";

import { FormSheet } from "@/components/form-sheet";
import { JournalForm } from "@/components/journal-form";
import { orpc } from "@/lib/orpc";

export function JournalOverlay({
  orgSlug,
  today,
  open,
  onClose,
}: {
  orgSlug: string;
  today: string;
  open: boolean;
  onClose: () => void;
}) {
  const saving = useIsMutating({ mutationKey: orpc.journal.post.mutationKey() }) > 0;

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      saving={saving}
      title="New journal"
      description="Move balances between accounts with a balanced voucher."
    >
      <JournalForm orgSlug={orgSlug} today={today} onClose={onClose} />
    </FormSheet>
  );
}
