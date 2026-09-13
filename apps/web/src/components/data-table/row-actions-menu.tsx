// Copyright (c) Midday Labs AB, AGPL-3.0, from midday-ai/midday@51587319f26a0ffaa9dfccab1920373cb65689b7
// Adapted from apps/dashboard/src/components/tables/customers/columns.tsx (ActionsCell)
// and tables/invoices/actions-menu.tsx: a dots trigger and an end-aligned menu.
import { Button } from "@accly/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@accly/ui/components/dropdown-menu";
import { ClientOnly } from "@tanstack/react-router";
import { EllipsisIcon } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

// On a fine pointer the trigger shows on row hover, keyboard focus, the open
// record's row, or while its menu is open; touch always shows it.
export function RowActionsMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ClientOnly fallback={null}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={label}
              className="text-muted-foreground group-focus-within:opacity-100 group-data-active:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100"
            />
          }
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44 p-1">
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
    </ClientOnly>
  );
}

// navigator.clipboard is absent on a plain-http origin such as an office LAN, so
// the item is not offered there. It renders only inside an open menu, on the client.
export function CopyMenuItem({
  text,
  copied,
  children,
}: {
  text: string;
  copied: string;
  children: ReactNode;
}) {
  if (!window.isSecureContext) return null;

  return (
    <DropdownMenuItem
      onClick={() =>
        void navigator.clipboard.writeText(text).then(
          () => toast.success(copied),
          () => toast.error("Could not copy"),
        )
      }
    >
      {children}
    </DropdownMenuItem>
  );
}
