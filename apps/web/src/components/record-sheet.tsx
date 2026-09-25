import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@accly/ui/components/sheet";
import { ClientOnly } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { stepRow } from "@/lib/row-focus";

/**
 * A register's record, opened over the list. ↑/↓ step to the neighbouring row and
 * closing returns to the list. `children` are the body, footer and nested dialogs.
 */
export function RecordSheet({
  rowId,
  title,
  status,
  description,
  onClose,
  onStep,
  children,
}: {
  rowId: string;
  title: ReactNode;
  status: ReactNode;
  description: ReactNode;
  onClose: () => void;
  onStep: (rowId: string) => void;
  children: ReactNode;
}) {
  return (
    <ClientOnly fallback={null}>
      <Sheet open onOpenChange={(open) => !open && onClose()}>
        <SheetContent onKeyDown={(event) => stepRow(event, rowId, onStep)}>
          <SheetHeader>
            <div className="flex min-w-0 items-center gap-2">
              <SheetTitle className="min-w-0 truncate font-mono">{title}</SheetTitle>
              {status}
            </div>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          {children}
        </SheetContent>
      </Sheet>
    </ClientOnly>
  );
}
