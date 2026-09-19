import { expect, test } from "bun:test";

import { presetLabel, presetRange, rangeLabel } from "../../apps/web/src/lib/date-presets";

test("month presets cross a year boundary from the business date", () => {
  expect(presetRange("this-month", "2026-01-15", 4)).toEqual({
    from: "2026-01-01",
    to: "2026-01-31",
  });
  expect(presetRange("last-month", "2026-01-15", 4)).toEqual({
    from: "2025-12-01",
    to: "2025-12-31",
  });
});

test("the financial year follows the organization's start month", () => {
  // March is still 2025-26 when the year opens in April, and 2026 when it opens in January.
  expect(presetRange("this-year", "2026-03-31", 4)).toEqual({
    from: "2025-04-01",
    to: "2026-03-31",
  });
  expect(presetRange("this-year", "2026-04-01", 4)).toEqual({
    from: "2026-04-01",
    to: "2027-03-31",
  });
  expect(presetRange("this-year", "2026-03-31", 1)).toEqual({
    from: "2026-01-01",
    to: "2026-12-31",
  });
  expect(presetRange("last-year", "2026-04-01", 4)).toEqual({
    from: "2025-04-01",
    to: "2026-03-31",
  });
});

test("a financial year is labelled by its span", () => {
  expect(presetLabel("this-year", "2026-03-31", 4)).toBe("This year (2025–26)");
  expect(presetLabel("this-year", "2026-03-31", 1)).toBe("This year (2026)");
});

test("a range is named by the preset it equals, else by its dates", () => {
  // The URL only ever holds dates, so the label has to come back out of them.
  expect(rangeLabel({}, "2026-03-01", 4)).toBe("All time");
  expect(rangeLabel({ from: "2025-04-01", to: "2026-03-31" }, "2026-03-31", 4)).toBe(
    "This year (2025–26)",
  );
  expect(rangeLabel({ from: "2026-01-05", to: "2026-01-05" }, "2026-03-01", 4)).toBe("5 Jan 2026");
  expect(rangeLabel({ from: "2026-01-05", to: "2026-01-09" }, "2026-03-01", 4)).toBe(
    "5 Jan 2026 – 9 Jan 2026",
  );
});
