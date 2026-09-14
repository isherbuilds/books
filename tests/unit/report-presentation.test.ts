import { expect, test } from "bun:test";

import { validateReportPeriod } from "../../apps/web/src/lib/report-presentation";

test("report period drafts reject incomplete and reversed ranges", () => {
  expect(validateReportPeriod("", "2026-08-21")).toBe("Choose both dates");
  expect(validateReportPeriod("2026-08-22", "2026-08-21")).toBe("From must be on or before To");
  expect(validateReportPeriod("2026-08-21", "2026-08-21")).toBeNull();
});
