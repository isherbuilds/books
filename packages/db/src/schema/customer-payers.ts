import { foreignKey, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { customers } from "./customers";
import { payers } from "./payers";

export const customerPayers = pgTable(
  "customer_payers",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    customerId: text("customer_id").notNull(),
    payerId: text("payer_id").notNull(),
    policyNumber: text("policy_number"),
    employeeNumber: text("employee_number"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.orgId, table.customerId],
      foreignColumns: [customers.orgId, customers.id],
    }),
    foreignKey({
      columns: [table.orgId, table.payerId],
      foreignColumns: [payers.orgId, payers.id],
    }),
    uniqueIndex("customer_payers_org_customer_idx").on(table.orgId, table.customerId),
  ],
);
