import { formatBusinessDate } from "@accly/api/lib/business-date";
import { tzOffset } from "@date-fns/tz";
import { getRouteApi } from "@tanstack/react-router";

const orgRoute = getRouteApi("/$orgSlug");

// An *instant* (`createdAt`) is a point in time, formatted in the org zone. A
// *business date* (`YYYY-MM-DD`) labels a day and is formatted in UTC, so it never
// slides into the day before or after. The two are not interchangeable.

// Constructing an Intl.DateTimeFormat costs far more than using one. A plain Map,
// not useMemo: loaders and the server call these outside any React render.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(
  key: string,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const cached = formatters.get(key);

  if (cached) return cached;

  const created = new Intl.DateTimeFormat(locale, options);
  formatters.set(key, created);

  return created;
}

// The wall clock in the org zone, from numeric parts only: month names and am/pm
// wording differ between ICU versions, so the server render would not hydrate.
function wallClock(instant: Date, timeZone: string) {
  const parts = formatter(`localMinute|${timeZone}`, "en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);

  const at = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;

  return {
    day: `${at("year")}-${at("month")}-${at("day")}`,
    hour: Number(at("hour")),
    minute: at("minute"),
  };
}

export function formatDateTime(value: string | Date, timeZone: string): string {
  const { day, hour, minute } = wallClock(new Date(value), timeZone);

  return `${formatBusinessDate(day)}, ${hour % 12 || 12}:${minute} ${hour < 12 ? "am" : "pm"}`;
}

export function formatDate(value: string | Date, timeZone: string): string {
  return formatBusinessDate(wallClock(new Date(value), timeZone).day);
}

/**
 * The instant a wall-clock time typed in the org zone (`YYYY-MM-DDTHH:mm`, as a
 * `datetime-local` input yields) names. The browser's own zone plays no part.
 * The offset is read at the guessed instant and once more at the corrected one,
 * so a DST change between the two settles on the right side. A skipped local time
 * is rejected instead of silently moving the operator's input across the DST gap.
 */
export function orgLocalToInstant(local: string, timeZone: string): Date {
  const asUtc = new Date(`${local}Z`);
  const guess = new Date(asUtc.getTime() - tzOffset(timeZone, asUtc) * 60_000);
  const instant = new Date(asUtc.getTime() - tzOffset(timeZone, guess) * 60_000);

  const clock = wallClock(instant, timeZone);
  const roundTrip = `${clock.day}T${String(clock.hour).padStart(2, "0")}:${clock.minute}`;

  if (roundTrip !== local) {
    throw new RangeError("This local time does not exist in the organization's time zone");
  }

  return instant;
}

/**
 * All three resolved by the layout loader, so server and client agree across
 * hydration and a list's default period cannot differ between them.
 */
export function useOrgDateTime(): {
  timeZone: string;
  today: string;
  financialYearStart: number;
} {
  return orgRoute.useLoaderData();
}
