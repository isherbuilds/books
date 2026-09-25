import { ORPCError } from "@orpc/server";

export const MASTER_LIST_LIMIT = 5000;

// Party lists past the bound return `pageOf(rows, MASTER_LIST_LIMIT)` and are searched
// on the server (client-patterns.md call 2). The other masters are complete or
// refused, never a truncated success: their fields resolve a saved id from the cached
// list. Query with `.limit(MASTER_LIST_LIMIT + 1)` so an overflow is detectable.
export function capMasterList<T>(rows: T[]): T[] {
  if (rows.length > MASTER_LIST_LIMIT) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This list exceeds 5,000 rows.",
      data: { reason: "MASTER_LIST_LIMIT" },
    });
  }

  return rows;
}
