import type { db, DbTransaction } from "@accly/db";
import { taxRates } from "@accly/db/schema/tax-rates";
import { tdsSections } from "@accly/db/schema/tds-sections";
import { and, eq, gte, inArray, isNull, lte, or, type Column } from "drizzle-orm";

import { badRequest } from "../lib/conflict";

// No GST0: nil and exempt supplies carry no rate, because the income Account's supply
// class already decides them. GST 2.0 (2025-09-22) ended the 12% slab, added 40%, and
// kept 28% only for tobacco goods until 2026-01-31.
const GST_SCHEDULE = [
  ["GST5", "GST 5%", 500, "2017-07-01", null],
  ["GST12", "GST 12%", 1_200, "2017-07-01", "2025-09-21"],
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

/** The TDS Sections effective on `date`; refuses an id that is not one of them. */
export async function effectiveTdsSections(
  executor: typeof db | DbTransaction,
  orgId: string,
  ids: readonly string[],
  date: string,
) {
  if (ids.length === 0) return [];

  const sections = await executor
    .select({
      id: tdsSections.id,
      code: tdsSections.code,
      rateBasisPoints: tdsSections.rateBasisPoints,
    })
    .from(tdsSections)
    .where(
      and(
        eq(tdsSections.orgId, orgId),
        inArray(tdsSections.id, [...ids]),
        effectiveOn(tdsSections, date),
      ),
    );

  if (sections.length !== ids.length)
    throw badRequest("TDS_SECTION_INVALID", "Choose a TDS section effective on this date.");

  return sections;
}

/** The Tax Rates effective on `date` for `codes`, keyed by code; a missing code has none. */
export async function ratesByCode(
  executor: typeof db | DbTransaction,
  orgId: string,
  codes: readonly string[],
  date: string,
): Promise<Map<string, { id: string; rateBasisPoints: number }>> {
  if (codes.length === 0) return new Map();

  const rates = await executor
    .select({ id: taxRates.id, code: taxRates.code, rateBasisPoints: taxRates.rateBasisPoints })
    .from(taxRates)
    .where(
      and(
        eq(taxRates.orgId, orgId),
        inArray(taxRates.code, [...codes]),
        effectiveOn(taxRates, date),
      ),
    );

  return new Map(rates.map(({ code, ...rate }) => [code, rate]));
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
