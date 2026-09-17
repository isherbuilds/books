import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { accounts } from "./accounts";
import { organization } from "./auth";

export const items = pgTable(
  "items",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    hsnSac: text("hsn_sac"),
    unit: text("unit"),
    unitPricePaise: bigint("unit_price_paise", { mode: "bigint" }).notNull(),
    incomeAccountId: text("income_account_id").notNull(),
    taxCode: text("tax_code"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    // Millisecond precision: the value round-trips through JSON as the edit token.
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.orgId, table.incomeAccountId],
      foreignColumns: [accounts.orgId, accounts.id],
    }),
    unique("items_org_id_id_unique").on(table.orgId, table.id),
    uniqueIndex("items_org_normalized_name_idx").on(table.orgId, table.normalizedName),
    index("items_org_name_idx").on(table.orgId, table.name),
    check("items_unit_price_paise_check", sql`${table.unitPricePaise} >= 0`),
  ],
);
