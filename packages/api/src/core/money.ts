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

/** A rupee text field's paise while typing; zero until it parses. */
export function enteredPaise(value: string): bigint {
  return NON_NEGATIVE_MONEY_PATTERN.test(value) ? parseMoney(value) : ZERO_MONEY;
}

/** Half-up integer division for non-negative money and a positive denominator. */
export function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
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

// These exist so no `.tsx` has to hold a bigint literal. oxc's React Compiler pass
// rewrites every bigint literal inside a component it compiles to `undefined`, with no
// error, so `paise === 0n` silently becomes `paise === undefined`. A module with no
// components is never compiled and is safe; `oxlint` bans bigint literals in `.tsx`.

/** Zero, for defaulting a total the server has not sent. */
export const ZERO_MONEY: Money = 0n;

export function isZeroMoney(paise: Money): boolean {
  return paise === 0n;
}

export function isPositiveMoney(paise: Money): boolean {
  return paise > 0n;
}

/** Magnitude without the sign. */
export function absMoney(paise: Money): Money {
  return paise < 0n ? -paise : paise;
}

/** The debit side of a signed ledger amount; zero when the amount is a credit. */
export function debitOf(paise: Money): Money {
  return paise > 0n ? paise : 0n;
}

/** The credit side of a signed ledger amount, unsigned; zero when the amount is a debit. */
export function creditOf(paise: Money): Money {
  return paise < 0n ? -paise : 0n;
}

/** A party balance the way a ledger prints it: Dr when the party owes, Cr for an advance held. */
export function formatBalance(paise: Money): string {
  if (isZeroMoney(paise)) return formatMoney(ZERO_MONEY);

  return `${formatMoney(absMoney(paise))} ${paise > 0n ? "Dr" : "Cr"}`;
}
