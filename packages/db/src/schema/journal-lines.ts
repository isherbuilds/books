import { sql } from "drizzle-orm";
import { bigint, check, date, foreignKey, index, pgTable, text } from "drizzle-orm/pg-core";

import { accounts } from "./accounts";
import { organization } from "./auth";
import { journalEntries } from "./journal-entries";
import { parties } from "./parties";

export const journalLines = pgTable(
  "journal_lines",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    entryId: text("entry_id").notNull(),
    entryDate: date("entry_date", { mode: "string" }).notNull(),
    accountId: text("account_id").notNull(),
    partyId: text("party_id"),
    debit: bigint("debit", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    credit: bigint("credit", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
  },
  (table) => [
    check("journal_lines_debit_check", sql`${table.debit} >= 0`),
    check("journal_lines_credit_check", sql`${table.credit} >= 0`),
    check("journal_lines_one_side_check", sql`(${table.debit} = 0) <> (${table.credit} = 0)`),
    foreignKey({
      columns: [table.orgId, table.entryId, table.entryDate],
      foreignColumns: [journalEntries.orgId, journalEntries.id, journalEntries.entryDate],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.orgId, table.accountId],
      foreignColumns: [accounts.orgId, accounts.id],
    }),
    foreignKey({
      columns: [table.orgId, table.partyId],
      foreignColumns: [parties.orgId, parties.id],
    }),
    // An account's lines by date. `debit` and `credit` trail the keyset so balance
    // sums read this index alone; Drizzle has no INCLUDE.
    index("journal_lines_org_account_date_idx").on(
      table.orgId,
      table.accountId,
      table.entryDate,
      table.id,
      table.debit,
      table.credit,
    ),
    index("journal_lines_org_entry_idx").on(table.orgId, table.entryId),
  ],
);
