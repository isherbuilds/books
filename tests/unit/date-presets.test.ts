import { expect, test } from "bun:test";

import { datePresets, dateRangeLabel } from "../../apps/web/src/lib/date-presets";

test("presets cross a month boundary from the business date", () => {
  const presets = Object.fromEntries(datePresets("2026-03-01").map((each) => [each.id, each]));

  expect(presets.yesterday).toMatchObject({ from: "2026-02-28", to: "2026-02-28" });
  expect(presets["last-month"]).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
  expect(presets["last-7-days"]).toMatchObject({ from: "2026-02-23", to: "2026-03-01" });
});

test("a range that is not a preset is labelled by its dates", () => {
  expect(dateRangeLabel("2026-03-01", "2026-02-01", "2026-02-28")).toBe("Last month");
  expect(dateRangeLabel("2026-03-01", "2026-01-05", "2026-01-05")).toBe("5 Jan 2026");
});
