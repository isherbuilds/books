export function businessDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Calendar year in which the financial year containing a business day begins. */
export function financialYearStartYear(day: string, startMonth: number): number {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));

  return month >= startMonth ? year : year - 1;
}

// Fixed English month names, not Intl: ICU versions disagree ("Sep" in Bun, "Sept" in
// Chrome), so a server render and its hydration would differ.
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function dayLabel(day: string, withYear: boolean): string {
  const [year, month, date] = day.split("-");

  return `${Number(date)} ${MONTHS[Number(month) - 1]}${withYear ? ` ${year}` : ""}`;
}

/** Format a calendar day ("8 Aug 2026") without shifting it across time zones. */
export function formatBusinessDate(day: string): string {
  return dayLabel(day, true);
}

/**
 * The compact day for list rows and nested tables: "12 Mar" in the current year, the
 * full date otherwise, so rows from different years never read alike. A record's own
 * date uses `formatBusinessDate`.
 */
export function formatBusinessDay(day: string): string {
  return dayLabel(day, !day.startsWith(`${new Date().getUTCFullYear()}-`));
}
