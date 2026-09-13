import { ORPCError } from "@orpc/server";

export const MASTER_LIST_LIMIT = 5000;

// A master list is complete or refused, never a truncated success: the Link Field
// and the palette search it in memory (client-patterns.md). Query with
// `.limit(MASTER_LIST_LIMIT + 1)` so an overflow is detectable.
export function capMasterList<T>(rows: T[]): T[] {
  if (rows.length > MASTER_LIST_LIMIT) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This list exceeds 5,000 rows.",
      data: { reason: "MASTER_LIST_LIMIT" },
    });
  }

  return rows;
}
