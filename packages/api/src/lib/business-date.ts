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
