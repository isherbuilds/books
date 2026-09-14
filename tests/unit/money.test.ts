import { expect, test } from "bun:test";

import { formatMoney, parseMoney } from "@accly/api/core/money";

import { money } from "@accly/api/lib/schemas";

test("formatMoney prints paise as exact en-IN rupees at any size", () => {
  expect(formatMoney(12345678990n)).toBe("₹12,34,56,789.90");
  expect(formatMoney(-5n)).toBe("-₹0.05");
  // Past 2^53 and past the 13-digit input cap: no float rounding and no parse limit.
  expect(formatMoney(10n ** 17n)).toBe("₹1,00,00,00,00,00,00,000.00");
});

test("calculated totals exceed the input cap without losing exact parsing", () => {
  expect(parseMoney("19999999999999.98")).toBe(1999999999999998n);
});

test("form limits stay enforced and malformed totals fail", () => {
  expect(money.safeParse("19999999999999.98").success).toBe(false);
  expect(() => parseMoney("1.001")).toThrow(RangeError);
});
