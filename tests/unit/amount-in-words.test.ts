import { expect, test } from "bun:test";

import { amountInWords } from "@accly/api/core/amount-in-words";

test("amountInWords uses Indian place values and paise", () => {
  expect(amountInWords(123_456_789n)).toBe(
    "Rupees Twelve Lakh Thirty-Four Thousand Five Hundred Sixty-Seven and Eighty-Nine Paise Only",
  );
});

test("amountInWords prints zero without a paise clause", () => {
  expect(amountInWords(0n)).toBe("Rupees Zero Only");
});

test("amountInWords omits the paise clause for whole rupees", () => {
  expect(amountInWords(1_200n)).toBe("Rupees Twelve Only");
});

test("amountInWords handles the thousand boundary", () => {
  expect(amountInWords(100_000n)).toBe("Rupees One Thousand Only");
});

test("amountInWords recurses on the crore part", () => {
  expect(amountInWords(123_000_000_000n)).toBe("Rupees One Hundred Twenty-Three Crore Only");
});
