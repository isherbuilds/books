export function businessDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

const businessDateFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeZone: "UTC",
});

/** Format a calendar day without shifting it across time zones. */
export function formatBusinessDate(day: string): string {
  return businessDateFormatter.format(new Date(`${day}T00:00:00Z`));
}

const compactDayFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/**
 * The compact day for list rows and nested tables: "12 Mar" in the current year, the
 * full date otherwise, so rows from different years never read alike. A record's own
 * date uses `formatBusinessDate`.
 */
export function formatBusinessDay(day: string): string {
  return day.startsWith(`${new Date().getUTCFullYear()}-`)
    ? compactDayFormatter.format(new Date(`${day}T00:00:00Z`))
    : formatBusinessDate(day);
}
