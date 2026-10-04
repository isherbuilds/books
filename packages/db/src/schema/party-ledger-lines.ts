import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { documents } from "./documents";
import { organization } from "./auth";
import { parties } from "./parties";

export const partyLedgerLines = pgTable(
  "party_ledger_lines",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    partyId: text("party_id").notNull(),
    documentId: text("document_id").notNull(),
    side: text("side", { enum: ["receivable", "payable"] }).notNull(),
    kind: text("kind", { enum: ["post", "reverse"] }).notNull(),
    amountPaise: bigint("amount_paise", { mode: "bigint" }).notNull(),
    entryDate: date("entry_date", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.orgId, table.partyId],
      foreignColumns: [parties.orgId, parties.id],
    }),
    foreignKey({
      columns: [table.orgId, table.documentId],
      foreignColumns: [documents.orgId, documents.id],
    }),
    // Party and side grouping with amounts available in the index.
    index("party_ledger_lines_org_party_idx").on(
      table.orgId,
      table.partyId,
      table.side,
      table.amountPaise,
    ),
    // A party's lines by date. `amount_paise` trails the keyset so statements and
    // today's `party.balances` sums read this index alone.
    index("party_ledger_lines_org_party_date_idx").on(
      table.orgId,
      table.partyId,
      table.entryDate,
      table.id,
      table.amountPaise,
    ),
    // A document posts at most one line per Party and cancels it at most once, so its
    // settlement capacity is one indexed row, never a sum.
    uniqueIndex("party_ledger_lines_org_document_party_kind_idx").on(
      table.orgId,
      table.documentId,
      table.partyId,
      table.kind,
    ),
    check("party_ledger_lines_side_check", sql`${table.side} in ('receivable', 'payable')`),
    check("party_ledger_lines_kind_check", sql`${table.kind} in ('post', 'reverse')`),
  ],
);
