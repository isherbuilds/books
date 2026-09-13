// Copyright (c) Midday Labs AB, AGPL-3.0, from midday-ai/midday@51587319f26a0ffaa9dfccab1920373cb65689b7
// Adapted from apps/dashboard/src/components/customers-column-visibility.tsx: a Base UI
// Menu of checkbox rows over URL state, in place of a Radix Popover over a cookie store.
import { Button } from "@accly/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@accly/ui/components/dropdown-menu";
import { ClientOnly } from "@tanstack/react-router";
import { SlidersHorizontalIcon } from "lucide-react";

function columnsTrigger(disabled: boolean) {
  return (
    <Button variant="outline" size="icon" aria-label="Columns" disabled={disabled}>
      <SlidersHorizontalIcon />
    </Button>
  );
}

export function ColumnVisibilityMenu<Id extends string>({
  options,
  shown,
  onToggle,
}: {
  options: readonly { id: Id; label: string }[];
  shown: ReadonlySet<Id>;
  onToggle: (id: Id, visible: boolean) => void;
}) {
  // Base UI popups stay behind ClientOnly; the server renders the same button, inert.
  return (
    <ClientOnly fallback={columnsTrigger(true)}>
      <DropdownMenu>
        <DropdownMenuTrigger render={columnsTrigger(false)} />
        <DropdownMenuContent align="end" className="w-48 p-1">
          {/* Base UI requires a GroupLabel inside a Group. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>Columns</DropdownMenuLabel>
            {options.map((option) => (
              <DropdownMenuCheckboxItem
                key={option.id}
                checked={shown.has(option.id)}
                onCheckedChange={(checked) => onToggle(option.id, checked)}
              >
                {option.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </ClientOnly>
  );
}
