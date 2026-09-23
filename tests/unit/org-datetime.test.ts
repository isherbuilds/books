import { expect, test } from "bun:test";

import { formatBusinessDate } from "@accly/api/lib/business-date";

import { orgLocalToInstant, orgToday } from "../../apps/web/src/lib/org-datetime";

test("organization dates follow the organization's accounting day", () => {
  const zone = "Asia/Kolkata";
  expect(orgToday(zone, new Date("2026-08-08T18:29:59.000Z"))).toBe("2026-08-08");
  expect(orgToday(zone, new Date("2026-08-08T18:30:00.000Z"))).toBe("2026-08-09");
  expect(orgToday("UTC", new Date("2026-08-08T18:30:00.000Z"))).toBe("2026-08-08");
});

test("business dates render with the year and cannot shift across time zones", () => {
  expect(formatBusinessDate("2026-08-08")).toBe("8 Aug 2026");
});

test("an org-local wall-clock time names one instant, across a DST change too", () => {
  expect(orgLocalToInstant("2026-09-21T18:30", "Asia/Kolkata").toISOString()).toBe(
    "2026-09-21T13:00:00.000Z",
  );
  // New York leaves DST at 02:00 on 1 Nov 2026: 01:30 before is EDT, 03:00 after is EST.
  expect(orgLocalToInstant("2026-11-01T01:30", "America/New_York").toISOString()).toBe(
    "2026-11-01T05:30:00.000Z",
  );
  expect(orgLocalToInstant("2026-11-01T03:00", "America/New_York").toISOString()).toBe(
    "2026-11-01T08:00:00.000Z",
  );
});

test("an org-local wall-clock time rejects a DST gap", () => {
  expect(() => orgLocalToInstant("2026-03-08T02:30", "America/New_York")).toThrow(RangeError);
});
