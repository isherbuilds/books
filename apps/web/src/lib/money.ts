import { formatDecimal, NON_NEGATIVE_MONEY_PATTERN, parseMoney } from "@accly/api/core/money";

const moneyFormatters = new Map<string, Intl.NumberFormat>();

/** Uses the API money pattern, so forms reject what the API would. */
export const MONEY_INPUT_PATTERN = NON_NEGATIVE_MONEY_PATTERN;

/** Form-boundary wrapper over the server's throwing parser: null for user typos. */
export function parseMoneyInput(value: string): bigint | null {
  return MONEY_INPUT_PATTERN.test(value) ? parseMoney(value) : null;
}

/**
 * Formats the decimal strings that legacy outpatient and billing procedures return;
 * slice 7 deletes it with those screens. Accounting-core amounts arrive as `bigint`
 * and use `formatMoney` from `@accly/api/core/money`.
 */
export function formatMoney(amount: string, currency: string): string {
  let formatter = moneyFormatters.get(currency);

  if (!formatter) {
    formatter = new Intl.NumberFormat("en-IN", { style: "currency", currency });
    moneyFormatters.set(currency, formatter);
  }

  const exactAmount = formatDecimal(parseMoney(amount));

  // SAFETY: formatDecimal returns plain decimal text, and Intl formats the exact value
  // of a numeric string rather than a binary float.
  return formatter.format(exactAmount as Intl.StringNumericLiteral);
}
