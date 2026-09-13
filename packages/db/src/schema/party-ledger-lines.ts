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
  unique,
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
    unique("party_ledger_lines_org_id_id_unique").on(table.orgId, table.id),
    index("party_ledger_lines_org_party_idx").on(table.orgId, table.partyId, table.side),
    index("party_ledger_lines_org_document_idx").on(table.orgId, table.documentId),
    check("party_ledger_lines_side_check", sql`${table.side} in ('receivable', 'payable')`),
    check("party_ledger_lines_kind_check", sql`${table.kind} in ('post', 'reverse')`),
  ],
);
