import { getRouteApi } from "@tanstack/react-router";

export { formatBusinessDate } from "./business-date";

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

export function formatDateTime(value: string | Date, timeZone: string): string {
  return formatter(`dateTime|${timeZone}`, "en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

export function formatDate(value: string | Date, timeZone: string): string {
  return formatter(`date|${timeZone}`, "en-IN", {
    dateStyle: "medium",
    timeZone,
  }).format(new Date(value));
}

/**
 * Pinned to UTC: the input names a day, not a moment, so formatting it in the org
 * zone would shift a midnight anchor onto the neighbouring date.
 */
export function formatDay(day: string): string {
  return formatter("day|UTC", "en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

// `en-CA` is the shortest way to get `YYYY-MM-DD` out of Intl.
export function orgToday(timeZone: string, now = new Date()): string {
  return formatter(`isoDate|${timeZone}`, "en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Milliseconds the zone's wall clock runs ahead of UTC at `instant`. */
function zoneOffset(instant: Date, timeZone: string): number {
  const parts = formatter(`offset|${timeZone}`, "en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const at = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  const wall = Date.UTC(
    at("year"),
    at("month") - 1,
    at("day"),
    at("hour"),
    at("minute"),
    at("second"),
  );

  return wall - Math.floor(instant.getTime() / 1000) * 1000;
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
  const guess = new Date(asUtc.getTime() - zoneOffset(asUtc, timeZone));
  const instant = new Date(asUtc.getTime() - zoneOffset(guess, timeZone));

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

  const roundTrip = `${at("year")}-${at("month")}-${at("day")}T${at("hour")}:${at("minute")}`;

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
