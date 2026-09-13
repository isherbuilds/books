import { sql } from "drizzle-orm";
import { bigint, date, foreignKey, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

import { accounts } from "./accounts";
import { organization } from "./auth";

export const balances = pgTable(
  "balances",
  {
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    month: date("month", { mode: "string" }).notNull(),
    debit: bigint("debit", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    credit: bigint("credit", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    foreignKey({
      columns: [table.orgId, table.accountId],
      foreignColumns: [accounts.orgId, accounts.id],
    }),
    primaryKey({ columns: [table.orgId, table.accountId, table.month] }),
  ],
);
