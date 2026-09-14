import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@accly/ui/components/sheet";
import { ClientOnly } from "@tanstack/react-router";
import type { ReactNode } from "react";

export function FormSheet({
  open,
  onClose,
  saving,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  saving: boolean;
  title: ReactNode;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <ClientOnly fallback={null}>
      <Sheet open={open} onOpenChange={() => !saving && onClose()}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          {children}
        </SheetContent>
      </Sheet>
    </ClientOnly>
  );
}
