import { Button } from "@accly/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@accly/ui/components/dropdown-menu";
import { EllipsisIcon } from "lucide-react";
import type { ReactNode } from "react";

/** A record Sheet's secondary actions, so the footer keeps only its primary ones. */
export function SheetActionsMenu({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" variant="outline" size="icon" aria-label="More actions" />}
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-44">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
