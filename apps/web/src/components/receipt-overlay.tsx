import { useIsMutating, useQuery } from "@tanstack/react-query";

import { FormSheet } from "@/components/form-sheet";
import { ReceiptForm, type ReceiptInvoice } from "@/components/receipt-form";
import { orpc } from "@/lib/orpc";
import { partyDetailOptions } from "@/lib/parties";
import { WaveLoader } from "@/components/wave-loader";

// A right Sheet at every width: a Party created from the form opens a same-width
// Sheet that covers this one, instead of a panel over a centred dialog.
export function ReceiptOverlay({
  orgSlug,
  today,
  invoice,
  payerId,
  refund,
  open,
  onClose,
}: {
  orgSlug: string;
  today: string;
  invoice?: ReceiptInvoice;
  payerId?: string;
  refund?: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const saving = useIsMutating({ mutationKey: orpc.receipt.post.mutationKey() }) > 0;

  const payer = useQuery(partyDetailOptions(orgSlug, payerId));

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      saving={saving}
      title="New receipt"
      description="Record money received by the organization."
    >
      {payerId && payer.isPending ? (
        <WaveLoader label="Loading party" className="justify-center px-3 py-4" />
      ) : (
        <ReceiptForm
          orgSlug={orgSlug}
          today={today}
          invoice={invoice}
          initialParty={payer.data ? { id: payer.data.id, name: payer.data.name } : undefined}
          initialRefund={refund}
          onClose={onClose}
        />
      )}
    </FormSheet>
  );
}
