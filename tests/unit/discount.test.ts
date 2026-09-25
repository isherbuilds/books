import { expect, test } from "bun:test";

import { splitDiscount } from "@accly/api/core/discount";

test("half-up residue belongs to the first strictly largest line and totals remain exact", () => {
  expect(splitDiscount([7n, 4n, 4n], 2n)).toEqual([0n, 1n, 1n]);
  expect(splitDiscount([8n, 3n, 2n], 2n)).toEqual([2n, 0n, 0n]);
  expect(splitDiscount([5n, 5n], 1n)).toEqual([0n, 1n]);
  const values = [11n, 9n, 7n];
  const shares = splitDiscount(values, 19n);
  expect(shares.reduce((sum, share) => sum + share, 0n)).toBe(19n);
  expect(shares.every((share, index) => share >= 0n && share <= values[index]!)).toBe(true);
});

test("discount cannot exceed the subtotal or be negative", () => {
  expect(splitDiscount([0n, 0n], 0n)).toEqual([0n, 0n]);
  expect(() => splitDiscount([1n], 2n)).toThrow(RangeError);
  expect(() => splitDiscount([1n], -1n)).toThrow(RangeError);
});

test("many small lines keep every discount within its line amount", () => {
  const values = Array<bigint>(100).fill(2n);
  const shares = splitDiscount(values, 51n);

  expect(shares.reduce((sum, share) => sum + share, 0n)).toBe(51n);
  expect(shares.every((share, index) => share >= 0n && share <= values[index]!)).toBe(true);
});
