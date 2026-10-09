import { sql, type AnyColumn, type SQL } from "drizzle-orm";

/**
 * A sum of paise as a bigint, zero when no row matches. `filter` sums only the rows it
 * accepts. Every money aggregate goes through here, so none returns null or a numeric.
 */
export function paiseSum(value: AnyColumn | SQL, filter?: SQL) {
  const summed = filter ? sql`sum(${value}) filter (where ${filter})` : sql`sum(${value})`;

  return sql<bigint>`coalesce(${summed}, 0)::bigint`.mapWith(BigInt);
}
