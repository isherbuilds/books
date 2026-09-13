// Copyright (c) Midday Labs AB, AGPL-3.0, from midday-ai/midday@51587319f26a0ffaa9dfccab1920373cb65689b7
// Adapted from apps/dashboard/src/components/transactions-search-filter.tsx, invoice-search-filter.tsx,
// filter-list.tsx and date-range-filter.tsx: Radix → Base UI Menu, nuqs → router search params.
import { Button } from "@accly/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@accly/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@accly/ui/components/dropdown-menu";
import { Input } from "@accly/ui/components/input";
import { ClientOnly } from "@tanstack/react-router";
import { ListFilterIcon, XIcon, type LucideIcon } from "lucide-react";
import { useState, type ReactNode, type RefObject } from "react";

import { datePresets } from "@/lib/date-presets";
import { validateReportPeriod } from "@/lib/report-presentation";

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
      <ListFilterIcon className="size-3.5" />
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
        <DropdownMenuContent anchor={anchor} align="end" className="p-1">
          {children}
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
        <Icon className="text-muted-foreground" />
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-72 p-1">{children}</DropdownMenuSubContent>
    </DropdownMenuSub>
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
export type ActiveFilter = { id: string; name: string; label: string; remove: () => Promise<void> };

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
              className="inline-flex h-8 max-w-64 items-center gap-1 rounded-md bg-muted px-2 text-xs text-muted-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground"
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

/** Presets from the organization's business date, then a custom range prompt. */
export function DateFilterItems({
  today,
  from,
  to,
  onChange,
  onCustom,
}: {
  today: string;
  from?: string;
  to?: string;
  onChange: (range: { from?: string; to?: string }) => void;
  onCustom: () => void;
}) {
  return (
    <>
      {datePresets(today).map((preset) => (
        <DropdownMenuCheckboxItem
          key={preset.id}
          checked={preset.from === from && preset.to === to}
          onCheckedChange={(checked) =>
            onChange(
              checked ? { from: preset.from, to: preset.to } : { from: undefined, to: undefined },
            )
          }
        >
          {preset.label}
        </DropdownMenuCheckboxItem>
      ))}
      <DropdownMenuSeparator className="my-1" />
      <DropdownMenuItem onClick={onCustom}>Custom range…</DropdownMenuItem>
    </>
  );
}

// A short prompt, not inputs inside a Menu: roving focus and typeahead fight typed dates.
export function DateRangeDialog({
  open,
  onOpenChange,
  from,
  to,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  from?: string;
  to?: string;
  onApply: (range: { from: string; to: string }) => void;
}) {
  return (
    <ClientOnly fallback={null}>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-sm">
          {/* A child owns the draft, so each open starts from the applied range. */}
          <DateRangeForm
            from={from}
            to={to}
            onApply={(range) => {
              onApply(range);
              onOpenChange(false);
            }}
            onCancel={() => onOpenChange(false)}
          />
        </DialogContent>
      </Dialog>
    </ClientOnly>
  );
}

function DateRangeForm({
  from,
  to,
  onApply,
  onCancel,
}: {
  from?: string;
  to?: string;
  onApply: (range: { from: string; to: string }) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState({ from: from ?? "", to: to ?? "" });
  const error = validateReportPeriod(draft.from, draft.to);

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();

        if (error === null) onApply(draft);
      }}
    >
      <DialogHeader>
        <DialogTitle>Custom range</DialogTitle>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-muted-foreground">From</span>
          <Input
            type="date"
            required
            value={draft.from}
            onChange={(event) => setDraft({ ...draft, from: event.currentTarget.value })}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-muted-foreground">To</span>
          <Input
            type="date"
            required
            value={draft.to}
            onChange={(event) => setDraft({ ...draft, to: event.currentTarget.value })}
          />
        </label>
      </div>
      {/* "Choose both dates" is not news while the operator is still choosing. */}
      {draft.from && draft.to && error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={error !== null}>
          Apply
        </Button>
      </DialogFooter>
    </form>
  );
}
