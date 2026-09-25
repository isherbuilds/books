import { expect, test } from "bun:test";

import { splitDiscount } from "@accly/api/core/discount";

test("shares total exactly, stay within each line and break ties deterministically", () => {
  expect(splitDiscount([7n, 4n, 4n], 2n)).toEqual([0n, 1n, 1n]);
  expect(splitDiscount([8n, 3n, 2n], 2n)).toEqual([2n, 0n, 0n]);
  expect(splitDiscount([5n, 5n], 1n)).toEqual([0n, 1n]);

  // Many small lines spill the rounding residue without exceeding any line.
  for (const [values, discount] of [
    [[11n, 9n, 7n], 19n],
    [Array<bigint>(100).fill(2n), 51n],
  ] as const) {
    const shares = splitDiscount(values, discount);
    expect(shares.reduce((sum, share) => sum + share, 0n)).toBe(discount);
    expect(shares.every((share, index) => share >= 0n && share <= values[index]!)).toBe(true);
  }
});

test("discount cannot exceed the subtotal or be negative", () => {
  expect(splitDiscount([0n, 0n], 0n)).toEqual([0n, 0n]);
  expect(() => splitDiscount([1n], 2n)).toThrow(RangeError);
  expect(() => splitDiscount([1n], -1n)).toThrow(RangeError);
});
