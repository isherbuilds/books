import {
  boolean,
  foreignKey,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { accounts } from "./accounts";
import { organization } from "./auth";

export const paymentMethods = pgTable(
  "payment_methods",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    accountId: text("account_id").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.orgId, table.accountId],
      foreignColumns: [accounts.orgId, accounts.id],
    }),
    unique("payment_methods_org_id_id_unique").on(table.orgId, table.id),
    uniqueIndex("payment_methods_org_name_idx").on(table.orgId, table.name),
  ],
);
