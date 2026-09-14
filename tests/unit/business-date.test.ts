import { expect, test } from "bun:test";

import { businessDate } from "@accly/api/lib/business-date";

test("changes the Kolkata business date at local midnight", () => {
  expect(businessDate(new Date("2026-08-08T18:29:59Z"), "Asia/Kolkata")).toBe("2026-08-08");
  expect(businessDate(new Date("2026-08-08T18:30:00Z"), "Asia/Kolkata")).toBe("2026-08-09");
});

test("rejects an invalid time zone", () => {
  expect(() => businessDate(new Date("2026-08-08T00:00:00Z"), "Asia/Nowhere")).toThrow();
});
