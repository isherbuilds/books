import { useIsMutating } from "@tanstack/react-query";

import { FormSheet } from "@/components/form-sheet";
import { ReceiptForm, type ReceiptInvoice } from "@/components/receipt-form";
import { orpc } from "@/lib/orpc";

// A right Sheet at every width: a Party created from the form opens a same-width
// Sheet that covers this one, instead of a panel over a centred dialog.
export function ReceiptOverlay({
  orgSlug,
  today,
  invoice,
  open,
  onClose,
}: {
  orgSlug: string;
  today: string;
  invoice?: ReceiptInvoice;
  open: boolean;
  onClose: () => void;
}) {
  const saving = useIsMutating({ mutationKey: orpc.receipt.post.mutationKey() }) > 0;

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      saving={saving}
      title="New receipt"
      description="Record money received by the organization."
    >
      <ReceiptForm orgSlug={orgSlug} today={today} invoice={invoice} onClose={onClose} />
    </FormSheet>
  );
}
