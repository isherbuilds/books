export function validateReportPeriod(from: string, to: string): string | null {
  if (!from || !to) return "Choose both dates";

  if (from > to) return "From must be on or before To";

  return null;
}
