import type { DbTransaction } from "@accly/db";
import { tdsSections } from "@accly/db/schema/tds-sections";

// Codes are Protean Form 140 Annexure 2 (v1.2, 22 Jul 2026) section codes. The
// Income-tax Act 2025 applies from 1 April 2026; 1961-Act codes such as 194C fail
// return validation. Thresholds are tax-year aggregates or per-month tests and
// are not modelled yet (see docs/specs/accounting-core.md#deferred).
const TDS_SCHEDULE = [
  ["1006", "Commission or brokerage, other than insurance commission — s.393(1) Table 1(ii)", 200],
  ["1008", "Rent, plant machinery or equipment — s.393(1) Table 2(ii)(a)", 200],
  ["1009", "Rent, land building or furniture — s.393(1) Table 2(ii)(b)", 1_000],
  [
    "1020",
    "Interest other than securities, senior citizen from bank/co-op/post office — s.393(1) Table 5(ii)(a)",
    1_000,
  ],
  [
    "1021",
    "Interest other than securities from bank/co-op/post office — s.393(1) Table 5(ii)(b)",
    1_000,
  ],
  ["1022", "Interest other than securities, other payer — s.393(1) Table 5(iii)", 1_000],
  ["1023", "Contractor, individual or HUF — s.393(1) Table 6(i)(a)", 100],
  ["1024", "Contractor, other than individual or HUF — s.393(1) Table 6(i)(b)", 200],
  [
    "1026",
    "Technical services, royalty for sale, distribution or exhibition of cinematographic films, or call centre — s.393(1) Table 6(iii)(a)",
    200,
  ],
  [
    "1027",
    "Professional services, other royalty, or non-compete sum — s.393(1) Table 6(iii)(b)",
    1_000,
  ],
  ["1028", "Director remuneration — s.393(1) Table 6(iii)(b)", 1_000],
  ["1031", "Purchase of goods — s.393(1) Table 8(ii)", 10],
  ["1067", "Partner salary, remuneration, commission or interest — s.393(3) Table 7", 1_000],
] as const;

export async function seedTdsSections(tx: DbTransaction, orgId: string): Promise<void> {
  await tx.insert(tdsSections).values(
    TDS_SCHEDULE.map(([code, description, rateBasisPoints]) => ({
      id: Bun.randomUUIDv7(),
      orgId,
      code,
      description,
      rateBasisPoints,
      effectiveFrom: "2026-04-01",
      effectiveTo: null,
    })),
  );
}
