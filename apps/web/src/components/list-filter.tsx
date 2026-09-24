// Copyright (c) Midday Labs AB, AGPL-3.0, from midday-ai/midday@51587319f26a0ffaa9dfccab1920373cb65689b7
// Adapted from apps/dashboard/src/components/transactions-search-filter.tsx, invoice-search-filter.tsx,
// filter-list.tsx and date-range-filter.tsx: Radix → Base UI Menu, nuqs → router search params.
import { Button } from "@accly/ui/components/button";
import { Calendar, type CalendarRange } from "@accly/ui/components/calendar";
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
import { Popover, PopoverContent } from "@accly/ui/components/popover";
import { useIsMobile } from "@accly/ui/hooks/use-mobile";
import { ClientOnly } from "@tanstack/react-router";
import { ListFilterIcon, XIcon, type LucideIcon } from "lucide-react";
import { useState, type ReactNode, type RefObject } from "react";

import {
  PRESETS,
  presetLabel,
  presetOf,
  presetRange,
  rangeLabel,
  spanLabel,
  type DateRange,
  type SearchRange,
} from "@/lib/date-presets";

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

const ALL_TIME: SearchRange = { from: undefined, to: undefined };

/**
 * Presets write their dates to the URL; All time removes both dates. The URL never
 * stores which label the operator clicked.
 */
export function PresetItems({
  range,
  today,
  financialYearStart,
  onSelect,
  onCustom,
}: {
  range: SearchRange;
  today: string;
  financialYearStart: number;
  onSelect: (range: SearchRange) => void;
  onCustom: () => void;
}) {
  const applied = presetOf(range, today, financialYearStart);
  const hasRange = Boolean(range.from || range.to);

  return (
    <>
      <DropdownMenuCheckboxItem checked={!hasRange} onCheckedChange={() => onSelect(ALL_TIME)}>
        All time
      </DropdownMenuCheckboxItem>
      {PRESETS.map((preset) => (
        <DropdownMenuCheckboxItem
          key={preset}
          checked={applied === preset}
          // Unchecking an applied period returns the list to all time, so it is never
          // left half-filtered.
          onCheckedChange={(checked) =>
            onSelect(checked ? presetRange(preset, today, financialYearStart) : ALL_TIME)
          }
        >
          {presetLabel(preset, today, financialYearStart)}
        </DropdownMenuCheckboxItem>
      ))}
      <DropdownMenuSeparator className="my-1" />
      {/* An Item, not a CheckboxItem: it hands over to the calendar, so the menu closes
          behind it instead of staying open under the popover. */}
      <DropdownMenuItem onClick={onCustom}>
        {hasRange && !applied ? rangeLabel(range, today, financialYearStart) : "Custom range…"}
      </DropdownMenuItem>
    </>
  );
}

// A business date names a day, so it converts by calendar fields, never through an
// instant: `new Date("2026-08-02")` is UTC midnight and reads back as 1 August west of
// Greenwich. The calendar stays in the browser's own frame and no day can shift.
function toDate(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);

  return new Date(year!, month! - 1, date!);
}

function toDay(date?: Date): string | undefined {
  if (!date) return undefined;

  const month = String(date.getMonth() + 1).padStart(2, "0");

  return `${date.getFullYear()}-${month}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * The custom range, picked on a month grid anchored to the control that opened it. Two
 * `type="date"` boxes in a modal asked the operator to type what a calendar shows.
 */
export function DateRangePopover({
  open,
  onOpenChange,
  anchor,
  from,
  to,
  today,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: RefObject<HTMLElement | null>;
  from?: string;
  to?: string;
  today: string;
  onApply: (range: DateRange) => void;
}) {
  return (
    <ClientOnly fallback={null}>
      <Popover open={open} onOpenChange={onOpenChange}>
        {/* A child owns the draft, so each open starts from the applied range. */}
        <PopoverContent
          anchor={anchor}
          align="start"
          aria-label="Custom range"
          className="w-auto p-0"
        >
          <DateRangeCalendar
            from={from}
            to={to}
            today={today}
            onApply={(range) => {
              onApply(range);
              onOpenChange(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </ClientOnly>
  );
}

function DateRangeCalendar({
  from,
  to,
  today,
  onApply,
}: {
  from?: string;
  to?: string;
  today: string;
  onApply: (range: DateRange) => void;
}) {
  const [draft, setDraft] = useState<CalendarRange | undefined>({
    from: from ? toDate(from) : undefined,
    to: to ? toDate(to) : undefined,
  });

  const months = useIsMobile() ? 1 : 2;
  const start = toDay(draft?.from);
  const end = toDay(draft?.to);

  return (
    <div className="grid pb-2">
      <Calendar
        autoFocus
        mode="range"
        today={toDate(today)}
        // Two months, so a range that crosses a month boundary is one drag rather than
        // a click, a page turn, and a second click. One month once that will not fit.
        numberOfMonths={months}
        defaultMonth={toDate(from ?? to ?? today)}
        selected={draft}
        onSelect={setDraft}
      />
      <div className="mx-2 flex items-center gap-2 border-t border-border pt-2">
        <p className="flex-1 text-muted-foreground">
          {start ? spanLabel({ from: start, to: end }) : "Pick the first day"}
        </p>
        <Button
          size="xs"
          disabled={!start || !end}
          onClick={() => start && end && onApply({ from: start, to: end })}
        >
          Apply
        </Button>
      </div>
    </div>
  );
}
