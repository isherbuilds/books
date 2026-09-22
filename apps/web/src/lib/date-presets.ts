// Copyright (c) Midday Labs AB, AGPL-3.0, from midday-ai/midday@51587319f26a0ffaa9dfccab1920373cb65689b7
// Adapted from apps/dashboard/src/utils/date-presets.ts: date-fns on the device clock
// becomes YYYY-MM-DD string maths from the organization's business date.
//
// The presets are the periods an accountant actually reconciles — a month, a financial
// year, today's cash — not a rolling window. A bare URL shows all time; presets are
// explicit choices the operator applies when they want to narrow the list.
//
// A list URL carries the two dates and nothing else. The preset is a label the range is
// matched back to, never a stored value: `?from=2026-04-01&to=2027-03-31` reads the same
// to the server, a bookmark and the operator, and no page has to agree on a vocabulary.
import { formatBusinessDate } from "@accly/api/lib/business-date";

/** A fully specified range produced by a preset or the calendar. */
export type DateRange = { from: string; to: string };

/** The range carried by list search params. Neither end means all time. */
export type SearchRange = { from?: string; to?: string };

export const PRESETS = ["today", "this-month", "last-month", "this-year", "last-year"] as const;

type Preset = (typeof PRESETS)[number];

// UTC throughout: a business date names a day, so a preset never shifts across zones.
function day(year: number, month: number, date: number): string {
  return new Date(Date.UTC(year, month - 1, date)).toISOString().slice(0, 10);
}

/**
 * The financial year containing `today`, as `financialYearStart` months into the
 * calendar. `financialYearOf` in the API numbers documents by the same rule.
 */
function financialYear(today: string, startMonth: number, offset: number): DateRange {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const startYear = (month >= startMonth ? year : year - 1) + offset;

  return {
    from: day(startYear, startMonth, 1),
    // Day 0 of the next start month is the last day of the year, leap years included.
    to: day(startYear + 1, startMonth, 0),
  };
}

export function presetRange(preset: Preset, today: string, financialYearStart: number): DateRange {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));

  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "this-month":
      return { from: day(year, month, 1), to: day(year, month + 1, 0) };
    case "last-month":
      return { from: day(year, month - 1, 1), to: day(year, month, 0) };
    case "this-year":
      return financialYear(today, financialYearStart, 0);
    case "last-year":
      return financialYear(today, financialYearStart, -1);
  }
}

/** The preset a range is, if both ends match one. */
export function presetOf(
  range: SearchRange,
  today: string,
  financialYearStart: number,
): Preset | undefined {
  const { from, to } = range;

  if (!from || !to) return undefined;

  return PRESETS.find((preset) => {
    const candidate = presetRange(preset, today, financialYearStart);

    return candidate.from === from && candidate.to === to;
  });
}

export function presetLabel(preset: Preset, today: string, financialYearStart: number): string {
  switch (preset) {
    case "today":
      return "Today";
    case "this-month":
      return "This month";
    case "last-month":
      return "Last month";
    // A financial year is named by its span (`2025–26`), never by one calendar year: an
    // April start makes "2025" ambiguous to the operator reading the chip.
    case "this-year":
    case "last-year": {
      const { from, to } = presetRange(preset, today, financialYearStart);
      const name = preset === "this-year" ? "This year" : "Last year";
      const startYear = Number(from.slice(0, 4));
      const endYear = Number(to.slice(0, 4));

      return startYear === endYear
        ? `${name} (${startYear})`
        : `${name} (${startYear}–${String(endYear % 100).padStart(2, "0")})`;
    }
  }
}

/** The literal span, for a range no preset names and for the calendar's own draft. */
export function spanLabel({ from, to }: { from: string; to?: string }): string {
  return !to || to === from
    ? formatBusinessDate(from)
    : `${formatBusinessDate(from)} – ${formatBusinessDate(to)}`;
}

/** What a search range is called: its preset, its dates, or its open-ended extent. */
export function rangeLabel(range: SearchRange, today: string, financialYearStart: number): string {
  const preset = presetOf(range, today, financialYearStart);
  const { from, to } = range;

  if (preset) return presetLabel(preset, today, financialYearStart);

  if (from) return to ? spanLabel({ from, to }) : `From ${formatBusinessDate(from)}`;

  return to ? `Until ${formatBusinessDate(to)}` : "All time";
}
