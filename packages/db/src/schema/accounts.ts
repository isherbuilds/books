import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const SUPPLY_CLASSES = ["taxable", "exempt", "nil", "nonGst", "notASupply"] as const;

export type SupplyClass = (typeof SUPPLY_CLASSES)[number];

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: text("type", { enum: ACCOUNT_TYPES }).notNull(),
    systemKey: text("system_key"),
    supplyClass: text("supply_class", { enum: SUPPLY_CLASSES }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.orgId, table.parentId],
      foreignColumns: [table.orgId, table.id],
      name: "accounts_parent_fk",
    }),
    unique("accounts_org_id_id_unique").on(table.orgId, table.id),
    uniqueIndex("accounts_org_code_idx").on(table.orgId, table.code),
    uniqueIndex("accounts_org_system_key_idx")
      .on(table.orgId, table.systemKey)
      .where(sql`${table.systemKey} is not null`),
    // Supply classes follow GST law and are validated in the application.
    check(
      "accounts_type_check",
      sql`${table.type} in ('asset', 'liability', 'equity', 'income', 'expense')`,
    ),
  ],
);
