// Copyright (c) Midday Labs AB, AGPL-3.0, from midday-ai/midday@51587319f26a0ffaa9dfccab1920373cb65689b7
// Adapted from apps/dashboard/src/components/date-range-filter.tsx: Radix → Base UI, nuqs → router search params.
import { Button } from "@accly/ui/components/button";
import { Calendar, type CalendarRange } from "@accly/ui/components/calendar";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@accly/ui/components/dropdown-menu";
import { Popover, PopoverContent } from "@accly/ui/components/popover";
import { useIsMobile } from "@accly/ui/hooks/use-mobile";
import { ClientOnly } from "@tanstack/react-router";
import { useState, type RefObject } from "react";

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
      <DropdownMenuSeparator />
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
