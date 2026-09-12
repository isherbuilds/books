/** Exact decimal rupees, including calculated totals larger than one input. */
const MONEY_PATTERN = /^-?\d+(\.\d{1,2})?$/;

export const NON_NEGATIVE_MONEY_PATTERN = /^\d{1,13}(\.\d{1,2})?$/;

/** Integer paise. Every table column and every calculation uses this; never a float. */
export type Money = bigint;

export function parseMoney(value: string): bigint {
  if (!MONEY_PATTERN.test(value)) {
    throw new RangeError(`Invalid money value: ${value}`);
  }

  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const dot = unsigned.indexOf(".");
  const rupees = dot === -1 ? unsigned : unsigned.slice(0, dot);
  const paise = dot === -1 ? "" : unsigned.slice(dot + 1);
  const amount = BigInt(rupees) * 100n + BigInt(paise.padEnd(2, "0"));

  return negative ? -amount : amount;
}

/** Plain decimal text such as "-12.50", for form values, audit metadata and messages. */
export function formatDecimal(paise: bigint): string {
  const negative = paise < 0n;
  const absolute = negative ? -paise : paise;
  const rupees = absolute / 100n;
  const remainder = (absolute % 100n).toString().padStart(2, "0");

  return `${negative ? "-" : ""}${rupees}.${remainder}`;
}

// Organizations are created in INR and cannot change currency, so one formatter
// serves every amount.
const rupeeFormat = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

/** Display text such as "₹1,23,456.78", exact at any size. */
export function formatMoney(paise: bigint): string {
  // SAFETY: a bigint's digits followed by E-2 always form a numeric string, and Intl
  // formats the exact value of a numeric string rather than a binary float.
  return rupeeFormat.format(`${paise}E-2` as Intl.StringNumericLiteral);
}

/** Half-up integer division for allocations and tax; denominator must be positive. */
export function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new Error("Division denominator must be positive");
  }

  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;

  return negative ? -rounded : rounded;
}
