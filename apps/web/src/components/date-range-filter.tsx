// Copyright (c) Midday Labs AB, AGPL-3.0, from midday-ai/midday@51587319f26a0ffaa9dfccab1920373cb65689b7
// Adapted from apps/dashboard/src/components/date-range-filter.tsx: Radix → Base UI, nuqs → router search params.
import { Button } from "@accly/ui/components/button";
import { Calendar, type CalendarRange } from "@accly/ui/components/calendar";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@accly/ui/components/dropdown-menu";
import { Popover, PopoverContent } from "@accly/ui/components/popover";
import { useIsMobile } from "@accly/ui/hooks/use-mobile";
import { ClientOnly } from "@tanstack/react-router";
import { CalendarIcon, ChevronDownIcon } from "lucide-react";
import { useRef, useState, type RefObject } from "react";

import { FilterSubmenu, type ActiveFilter } from "@/components/list-filter";
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
import { useOrgDateTime } from "@/lib/org-datetime";

const ALL_TIME: SearchRange = { from: undefined, to: undefined, all: true };

/**
 * Presets write their dates to the URL; All time removes both dates and says so, or the
 * page would move back to its default period. The URL never stores which preset was
 * clicked.
 */
function PresetItems({
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
            onSelect(
              checked
                ? { ...presetRange(preset, today, financialYearStart), all: undefined }
                : ALL_TIME,
            )
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

// A business date names a day, so it converts as local midnight, never as an instant:
// `new Date("2026-08-02")` is UTC midnight and reads back as 1 August west of Greenwich,
// while a date-time without an offset is local time. No day can shift.
function toDate(day: string): Date {
  return new Date(`${day}T00:00`);
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
function DateRangePopover({
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

/**
 * A list's date filter: its label, its chip while a range applies, the menu's period
 * submenu and the custom-range popover the submenu opens. Render `popover` outside the
 * menu so it outlives the menu closing.
 */
export function useDateRangeFilter(
  range: SearchRange,
  anchor: RefObject<HTMLElement | null>,
  onChange: (range: SearchRange) => Promise<void>,
) {
  const { today, financialYearStart } = useOrgDateTime();
  const [customOpen, setCustomOpen] = useState(false);
  const label = rangeLabel(range, today, financialYearStart);

  const chip: ActiveFilter | null =
    range.from || range.to
      ? { id: "date", name: "Date", label, remove: () => onChange(ALL_TIME) }
      : null;

  return {
    label,
    chip,
    submenu: (
      <FilterSubmenu icon={CalendarIcon} label={label}>
        <PresetItems
          range={range}
          today={today}
          financialYearStart={financialYearStart}
          onSelect={(next) => void onChange(next)}
          onCustom={() => setCustomOpen(true)}
        />
      </FilterSubmenu>
    ),
    popover: (
      <DateRangePopover
        open={customOpen}
        onOpenChange={setCustomOpen}
        anchor={anchor}
        from={range.from}
        to={range.to}
        today={today}
        onApply={(next) => void onChange({ ...next, all: undefined })}
      />
    ),
  };
}

/** A tab's own period control, for a page with no filter menu: presets, then the calendar. */
export function PeriodMenu({
  range,
  onChange,
}: {
  range: SearchRange;
  onChange: (range: SearchRange) => void;
}) {
  const { today, financialYearStart } = useOrgDateTime();
  const trigger = useRef<HTMLButtonElement>(null);
  const [customOpen, setCustomOpen] = useState(false);

  const periodTrigger = (
    <Button ref={trigger} variant="outline">
      <CalendarIcon data-icon="inline-start" />
      {rangeLabel(range, today, financialYearStart)}
      <ChevronDownIcon data-icon="inline-end" />
    </Button>
  );

  return (
    <>
      <ClientOnly fallback={periodTrigger}>
        <DropdownMenu>
          <DropdownMenuTrigger render={periodTrigger} />
          <DropdownMenuContent>
            <DropdownMenuGroup>
              <PresetItems
                range={range}
                today={today}
                financialYearStart={financialYearStart}
                onSelect={onChange}
                onCustom={() => setCustomOpen(true)}
              />
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </ClientOnly>
      <DateRangePopover
        open={customOpen}
        onOpenChange={setCustomOpen}
        anchor={trigger}
        from={range.from}
        to={range.to}
        today={today}
        onApply={(next) => onChange({ ...next, all: undefined })}
      />
    </>
  );
}
