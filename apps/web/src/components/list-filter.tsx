// Copyright (c) Midday Labs AB, AGPL-3.0, from midday-ai/midday@51587319f26a0ffaa9dfccab1920373cb65689b7
// Adapted from apps/dashboard/src/components/transactions-search-filter.tsx, invoice-search-filter.tsx
// and filter-list.tsx: Radix → Base UI Menu, nuqs → router search params.
import { Button } from "@accly/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@accly/ui/components/dropdown-menu";
import { ClientOnly } from "@tanstack/react-router";
import { ListFilterIcon, XIcon, type LucideIcon } from "lucide-react";
import type { ReactNode, RefObject } from "react";

/** Add or remove one value; an empty selection leaves the URL. */
export function toggleValue<T>(values: readonly T[] | undefined, value: T): T[] | undefined {
  const next = values?.includes(value)
    ? values.filter((each) => each !== value)
    : [...(values ?? []), value];

  return next.length > 0 ? next : undefined;
}

// Colour, not opacity, marks an active filter; nothing animates.
function filterTrigger(active: boolean, disabled: boolean) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label="Filters"
      disabled={disabled}
      data-active={active || undefined}
      className="text-muted-foreground data-active:text-foreground data-popup-open:text-foreground"
    >
      <ListFilterIcon data-icon="inline-start" />
    </Button>
  );
}

/** The filter button inside the search field; its menu is exactly as wide as the field. */
export function FilterMenu({
  anchor,
  active,
  children,
}: {
  anchor: RefObject<HTMLDivElement | null>;
  active: boolean;
  children: ReactNode;
}) {
  // Base UI popups stay behind ClientOnly; the server renders the same button, inert.
  return (
    <ClientOnly fallback={filterTrigger(active, true)}>
      <DropdownMenu>
        <DropdownMenuTrigger render={filterTrigger(active, false)} />
        <DropdownMenuContent anchor={anchor} align="end">
          <DropdownMenuGroup>{children}</DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </ClientOnly>
  );
}

export function FilterSubmenu({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Icon />
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-72">
        <DropdownMenuGroup>{children}</DropdownMenuGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** A single-choice submenu: checking the applied option again removes the filter. */
export function OptionFilter<T extends string>({
  icon,
  label,
  options,
  labels,
  value,
  onChange,
}: {
  icon: LucideIcon;
  label: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T | undefined;
  onChange: (value: T | undefined) => void;
}) {
  return (
    <FilterSubmenu icon={icon} label={label}>
      {options.map((option) => (
        <DropdownMenuCheckboxItem
          key={option}
          checked={value === option}
          onCheckedChange={(checked) => onChange(checked ? option : undefined)}
        >
          {labels[option]}
        </DropdownMenuCheckboxItem>
      ))}
    </FilterSubmenu>
  );
}

/**
 * Move focus to the search box before the focused control unmounts. `empty` clears the
 * text first: SearchInput never syncs a focused box, so a cleared `q` would
 * leave the old text on screen.
 */
export function focusSearch(field: RefObject<HTMLDivElement | null>, { empty = false } = {}) {
  const box = field.current?.querySelector("input");

  if (!box) return;

  if (empty) box.value = "";

  box.focus();
}

/** One applied filter, labelled by the route that owns its names. */
export type ActiveFilter = {
  id: string;
  name: string;
  label: string;
  remove: () => Promise<void>;
};

/** `onClear` must move focus itself (see focusSearch): Clear unmounts with the last chip. */
export function FilterChips({
  filters,
  field,
  onClear,
}: {
  filters: ActiveFilter[];
  field: RefObject<HTMLDivElement | null>;
  onClear: () => void;
}) {
  if (filters.length === 0) return null;

  return (
    <>
      <ul aria-label="Active filters" className="flex flex-wrap items-center gap-2">
        {filters.map((filter) => (
          <li key={filter.id}>
            <button
              type="button"
              title={filter.label}
              aria-label={`Remove ${filter.name} filter: ${filter.label}`}
              className="inline-flex h-8 max-w-64 items-center gap-1 rounded-md bg-muted px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={(event) => {
                // The chip unmounts: keep keyboard focus on the next chip, else the field.
                const next = event.currentTarget
                  .closest("li")
                  ?.nextElementSibling?.querySelector("button");

                void filter.remove().then(() => (next ? next.focus() : focusSearch(field)));
              }}
            >
              <span className="truncate">{filter.label}</span>
              <XIcon aria-hidden className="size-3.5 shrink-0" />
            </button>
          </li>
        ))}
      </ul>
      <Button variant="ghost" onClick={onClear}>
        Clear
      </Button>
    </>
  );
}
