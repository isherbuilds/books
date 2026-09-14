import { sql } from "drizzle-orm";
import { check, date, integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

import { organization } from "./auth";

// effectiveTo is the last day a row applies (inclusive). The database only refuses two rows
// of one code starting on the same day; whoever writes sections must keep ranges apart.
export const tdsSections = pgTable(
  "tds_sections",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    description: text("description").notNull(),
    rateBasisPoints: integer("rate_basis_points").notNull(),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    effectiveTo: date("effective_to", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("tds_sections_org_id_id_unique").on(table.orgId, table.id),
    unique("tds_sections_org_id_code_effective_from_unique").on(
      table.orgId,
      table.code,
      table.effectiveFrom,
    ),
    // Rates are dated data from the statute; the writer validates them.
    check(
      "tds_sections_effective_range_check",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} >= ${table.effectiveFrom}`,
    ),
  ],
);
