import { expect, test } from "bun:test";

import { formatBusinessDate } from "@accly/api/lib/business-date";

test("business dates render with the year and cannot shift across time zones", () => {
  expect(formatBusinessDate("2026-08-08")).toBe("8 Aug 2026");
});
