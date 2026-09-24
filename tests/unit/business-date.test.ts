import { expect, test } from "bun:test";

import { businessDate, formatBusinessDay } from "@accly/api/lib/business-date";

test("changes the Kolkata business date at local midnight", () => {
  expect(businessDate(new Date("2026-08-08T18:29:59Z"), "Asia/Kolkata")).toBe("2026-08-08");
  expect(businessDate(new Date("2026-08-08T18:30:00Z"), "Asia/Kolkata")).toBe("2026-08-09");
});

test("rejects an invalid time zone", () => {
  expect(() => businessDate(new Date("2026-08-08T00:00:00Z"), "Asia/Nowhere")).toThrow();
});

test("a list day keeps its year unless it falls in the current year", () => {
  const year = new Date().getUTCFullYear();

  expect(formatBusinessDay(`${year}-03-12`)).toBe("12 Mar");
  expect(formatBusinessDay(`${year - 1}-03-12`)).toBe(`12 Mar ${year - 1}`);
});
