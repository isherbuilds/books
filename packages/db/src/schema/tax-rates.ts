import { sql } from "drizzle-orm";
import {
  check,
  date,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";

// effectiveTo is the last day a row applies (inclusive). Rates are append-only dated data;
// whoever writes them must keep ranges for one code apart.
export const taxRates = pgTable(
  "tax_rates",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    rateBasisPoints: integer("rate_basis_points").notNull(),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    effectiveTo: date("effective_to", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("tax_rates_org_id_id_unique").on(table.orgId, table.id),
    uniqueIndex("tax_rates_org_code_from_idx").on(table.orgId, table.code, table.effectiveFrom),
    check("tax_rates_rate_basis_points_check", sql`${table.rateBasisPoints} between 0 and 10000`),
    check(
      "tax_rates_effective_range_check",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} >= ${table.effectiveFrom}`,
    ),
  ],
);
