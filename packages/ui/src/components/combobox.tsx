"use client";

// Copyright (c) Midday Labs AB, AGPL-3.0, from midday-ai/midday@51587319f26a0ffaa9dfccab1920373cb65689b7.
// Row, popup, trigger and clear styling adapted from
// packages/ui/src/components/{combobox-dropdown,combobox,command}.tsx, on Base UI.

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { ChevronsUpDownIcon, XIcon } from "lucide-react";
import * as React from "react";

import { Input } from "@accly/ui/components/input";
import { cn } from "@accly/ui/lib/utils";

type ComboboxProps<T> = {
  items: readonly T[];
  getItemKey: (item: T) => React.Key;
  getItemLabel: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  defaultInputValue?: string;
  inputValue?: string;
  /** Selected record; `null` keeps the input free text after a pick (the legacy pickers). */
  value?: T | null;
  onInputValueChange?: (value: string) => void;
  /** Return `false` to keep the value and the open list, as a Load more row does. */
  onSelect: (item: T) => void | false;
  emptyContent?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  autoHighlight?: boolean;
  disabled?: boolean;
  /** A trailing chevron that opens the list; pointer-only, so it adds no Tab stop. */
  showTrigger?: boolean;
  /** Renders a pointer-only clear button while a value is selected. */
  onClear?: () => void;
  /** Mirrors the highlighted row, so a consumer can commit it on Tab. */
  onItemHighlighted?: (item: T | undefined) => void;
  inputRef?: React.Ref<HTMLInputElement>;
  inputProps?: Omit<
    React.ComponentPropsWithoutRef<"input">,
    "className" | "disabled" | "onChange" | "value"
  >;
  inputClassName?: string;
  itemClassName?: string;
};

const ITEM_CLASS =
  "group/combobox-item relative flex min-h-8 cursor-default items-center gap-2 rounded-md px-2 py-2 text-xs outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50";

const TRAILING_BUTTON =
  "flex size-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground";

// Consumers own filtering and selection; this supplies the accessible input, popup
// and keyboard behaviour only. Object values are intentional: both current callers
// need the selected record, so a createItems collection would require another lookup.
function Combobox<T>({
  items,
  getItemKey,
  getItemLabel,
  renderItem,
  defaultInputValue,
  inputValue,
  value = null,
  onInputValueChange,
  onSelect,
  emptyContent,
  open,
  onOpenChange,
  autoHighlight,
  disabled,
  showTrigger,
  onClear,
  onItemHighlighted,
  inputRef,
  inputProps,
  inputClassName,
  itemClassName,
}: ComboboxProps<T>) {
  const itemClass = cn(ITEM_CLASS, itemClassName);
  const clearable = onClear !== undefined && value != null;

  const renderRow = (item: T) => (
    <ComboboxPrimitive.Item
      key={getItemKey(item)}
      value={item}
      data-slot="combobox-item"
      className={itemClass}
    >
      {renderItem(item)}
    </ComboboxPrimitive.Item>
  );

  const input = (
    <ComboboxPrimitive.Input
      ref={inputRef}
      render={<Input data-slot="combobox-input" />}
      className={cn(
        showTrigger && "pr-8",
        clearable && (showTrigger ? "pr-14" : "pr-8"),
        inputClassName,
      )}
      {...inputProps}
    />
  );

  return (
    <ComboboxPrimitive.Root<T>
      items={items}
      // Consumers already filtered; handing the same list back is the documented way to
      // skip Base UI's own pass. `filter={null}` still walks every item.
      filteredItems={items}
      value={value}
      // Callers pass fresh `{ id, name }` objects, so compare by key: this marks the
      // selected row (the check) and highlights it when the list opens.
      isItemEqualToValue={(item, selected) => getItemKey(item) === getItemKey(selected)}
      defaultInputValue={defaultInputValue}
      inputValue={inputValue}
      onInputValueChange={(next, details) => {
        // Base UI clears a closed input on Esc and keeps the key from the overlay. A
        // picked record stays shown instead, and Esc closes the enclosing overlay.
        if (details.reason === "escape-key" && value != null) {
          details.allowPropagation();

          return;
        }

        if (details.reason !== "item-press") onInputValueChange?.(next);
      }}
      onValueChange={(item, details) => {
        if (item != null) {
          if (onSelect(item) === false) details.cancel();
        } else if (details.reason === "clear-press") onClear?.();
      }}
      onItemHighlighted={onItemHighlighted}
      open={open}
      onOpenChange={onOpenChange}
      autoHighlight={autoHighlight}
      itemToStringLabel={getItemLabel}
      loopFocus
      disabled={disabled}
    >
      {showTrigger || onClear ? (
        <ComboboxPrimitive.InputGroup className="relative">
          {input}
          <span className="absolute inset-y-0 right-1 flex items-center gap-0.5">
            {clearable ? (
              <ComboboxPrimitive.Clear aria-label="Clear" className={TRAILING_BUTTON}>
                <XIcon className="size-4" />
              </ComboboxPrimitive.Clear>
            ) : null}
            {showTrigger ? (
              <ComboboxPrimitive.Trigger aria-label="Show options" className={TRAILING_BUTTON}>
                <ChevronsUpDownIcon className="size-4" />
              </ComboboxPrimitive.Trigger>
            ) : null}
          </span>
        </ComboboxPrimitive.InputGroup>
      ) : (
        input
      )}
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner
          className="isolate z-50 outline-none"
          sideOffset={4}
          align="start"
        >
          <ComboboxPrimitive.Popup
            data-slot="combobox-content"
            className={cn(
              "z-50 w-(--anchor-width) max-w-(--available-width) overflow-hidden rounded-md bg-popover text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none",
              emptyContent == null && "data-empty:hidden",
            )}
          >
            <ComboboxPrimitive.Empty data-slot="combobox-empty" className="text-muted-foreground">
              {emptyContent}
            </ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List
              data-slot="combobox-list"
              className="max-h-[min(18rem,var(--available-height))] overflow-y-auto overscroll-contain p-1 outline-none data-empty:p-0"
            >
              {renderRow}
            </ComboboxPrimitive.List>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  );
}

export { Combobox, type ComboboxProps };
