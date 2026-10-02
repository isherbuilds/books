"use client";

// Copyright (c) Midday Labs AB, AGPL-3.0, from midday-ai/midday@51587319f26a0ffaa9dfccab1920373cb65689b7.
// Popup and row styling adapted from packages/ui/src/components/{combobox-dropdown,combobox}.tsx.

import { Combobox as Primitive } from "@base-ui/react/combobox";

import { Input } from "@accly/ui/components/input";
import { cn } from "@accly/ui/lib/utils";

const Combobox = Primitive.Root;

function ComboboxInput(props: Primitive.Input.Props) {
  return <Primitive.Input data-slot="combobox-input" render={<Input />} {...props} />;
}

function ComboboxContent({ className, ...props }: Primitive.Popup.Props) {
  return (
    <Primitive.Portal>
      <Primitive.Positioner className="isolate z-50 outline-none" sideOffset={4} align="start">
        <Primitive.Popup
          data-slot="combobox-content"
          className={cn(
            "z-50 w-(--anchor-width) max-w-(--available-width) overflow-hidden rounded-md bg-popover text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none",
            className,
          )}
          {...props}
        />
      </Primitive.Positioner>
    </Primitive.Portal>
  );
}

function ComboboxList({ className, ...props }: Primitive.List.Props) {
  return (
    <Primitive.List
      data-slot="combobox-list"
      className={cn(
        "max-h-[min(18rem,var(--available-height))] overflow-y-auto overscroll-contain p-1 outline-none data-empty:p-0",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxItem({ className, ...props }: Primitive.Item.Props) {
  return (
    <Primitive.Item
      data-slot="combobox-item"
      className={cn(
        "group/combobox-item relative flex min-h-8 cursor-default items-center gap-2 rounded-md px-2 py-2 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxEmpty({ className, ...props }: Primitive.Empty.Props) {
  return (
    <Primitive.Empty
      data-slot="combobox-empty"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem, ComboboxEmpty };
