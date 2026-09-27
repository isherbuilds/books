import { Button } from "@accly/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@accly/ui/components/dialog";
import { Textarea } from "@accly/ui/components/textarea";
import { ClientOnly } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

type Question = {
  title: string;
  description: ReactNode;
  confirmLabel: string;
};

type ReasonQuestion = Question & {
  placeholder: string;
  /** The button that leaves the record as it is: "Keep invoice". */
  keepLabel: string;
  pendingLabel: string;
};

/** A destructive confirmation that needs a written reason, such as a cancel or a reversal. */
export function ReasonDialog({
  open,
  pending,
  title,
  description,
  onClose,
  ...body
}: ReasonQuestion & {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  return (
    <ClientOnly fallback={null}>
      <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <ReasonBody pending={pending} onClose={onClose} {...body} />
        </DialogContent>
      </Dialog>
    </ClientOnly>
  );
}

// The reason lives inside the popup, which unmounts on close, so a reopened dialog
// starts empty without a reset at every close path.
function ReasonBody({
  placeholder,
  keepLabel,
  confirmLabel,
  pendingLabel,
  pending,
  onClose,
  onConfirm,
}: Omit<ReasonQuestion, "title" | "description"> & {
  pending: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <>
      <label className="grid gap-2 text-sm">
        <span>Reason</span>
        <Textarea
          required
          autoFocus
          value={reason}
          maxLength={500}
          rows={4}
          disabled={pending}
          onChange={(event) => setReason(event.currentTarget.value)}
          placeholder={placeholder}
        />
      </label>
      <DialogFooter>
        <Button variant="ghost" disabled={pending} onClick={onClose}>
          {keepLabel}
        </Button>
        <Button
          variant="destructive"
          disabled={pending || reason.trim().length === 0}
          onClick={() => onConfirm(reason.trim())}
        >
          {pending ? pendingLabel : confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

type Pending = Question & { run: () => void };

/** A destructive yes/no question; `ReasonDialog` asks for a written reason instead. */
export function useConfirm(): [(action: Pending) => void, ReactNode] {
  const [pending, setPending] = useState<Pending | null>(null);
  const close = () => setPending(null);

  const dialog = (
    <ClientOnly fallback={null}>
      <Dialog open={pending !== null} onOpenChange={(next) => !next && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending?.title}</DialogTitle>
            <DialogDescription>{pending?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              autoFocus
              onClick={() => {
                pending?.run();
                close();
              }}
            >
              {pending?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ClientOnly>
  );

  return [setPending, dialog];
}
