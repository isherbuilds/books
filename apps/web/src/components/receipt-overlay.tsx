import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@accly/ui/components/sheet";
import { ClientOnly } from "@tanstack/react-router";

import { ReceiptForm } from "@/components/receipt-form";

// A right Sheet at every width: a Party created from the form opens a same-width
// Sheet that covers this one, instead of a panel over a centred dialog.
export function ReceiptOverlay({
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
  return (
    <ClientOnly fallback={null}>
      <Sheet open={open} onOpenChange={onClose}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>New receipt</SheetTitle>
            <SheetDescription>Record money received by the organization.</SheetDescription>
          </SheetHeader>
          <ReceiptForm orgSlug={orgSlug} today={today} onClose={onClose} />
        </SheetContent>
      </Sheet>
    </ClientOnly>
  );
}
