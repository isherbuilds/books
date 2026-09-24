import type { DbTransaction } from "@accly/db";
import { taxRates } from "@accly/db/schema/tax-rates";
import { and, gte, isNull, lte, or, type Column } from "drizzle-orm";

// No GST0: nil and exempt supplies carry no rate, because the income Account's supply
// class already decides them. GST 2.0 added 40% on 2025-09-22 and moved the last 28%
// supplies to it after 2026-01-31.
const GST_SCHEDULE = [
  ["GST5", "GST 5%", 500, "2017-07-01", null],
  ["GST12", "GST 12%", 1_200, "2017-07-01", null],
  ["GST18", "GST 18%", 1_800, "2017-07-01", null],
  ["GST28", "GST 28%", 2_800, "2017-07-01", "2026-01-31"],
  ["GST40", "GST 40%", 4_000, "2025-09-22", null],
] as const;

/**
 * The dated schedule row (a Tax Rate or TDS Section) that applies on `date`; ranges
 * are inclusive at both ends.
 */
export function effectiveOn(table: { effectiveFrom: Column; effectiveTo: Column }, date: string) {
  return and(
    lte(table.effectiveFrom, date),
    or(isNull(table.effectiveTo), gte(table.effectiveTo, date)),
  );
}

export async function seedTaxRates(tx: DbTransaction, orgId: string): Promise<void> {
  await tx.insert(taxRates).values(
    GST_SCHEDULE.map(([code, name, rateBasisPoints, effectiveFrom, effectiveTo]) => ({
      id: Bun.randomUUIDv7(),
      orgId,
      code,
      name,
      rateBasisPoints,
      effectiveFrom,
      effectiveTo,
    })),
  );
}
