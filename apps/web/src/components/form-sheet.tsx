import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@accly/ui/components/sheet";
import { ClientOnly } from "@tanstack/react-router";
import type { ComponentProps, ReactNode } from "react";

export function FormSheet({
  open,
  onClose,
  saving,
  title,
  description,
  initialFocus,
  children,
}: {
  open: boolean;
  onClose: () => void;
  saving: boolean;
  title: ReactNode;
  description: ReactNode;
  /** Base UI owns focus: what it focuses on open is where it returns from on close. */
  initialFocus?: ComponentProps<typeof SheetContent>["initialFocus"];
  children: ReactNode;
}) {
  return (
    <ClientOnly fallback={null}>
      <Sheet open={open} onOpenChange={() => !saving && onClose()}>
        <SheetContent initialFocus={initialFocus}>
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
