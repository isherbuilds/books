import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    documentType: text("document_type").notNull(),
    documentId: text("document_id").notNull(),
    kind: text("kind", { enum: ["post", "reverse"] }).notNull(),
    reversesEntryId: text("reverses_entry_id"),
    entryDate: date("entry_date", { mode: "string" }).notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }).defaultNow().notNull(),
    narration: text("narration").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
  },
  (table) => [
    foreignKey({
      columns: [table.orgId, table.reversesEntryId],
      foreignColumns: [table.orgId, table.id],
    }),
    unique("journal_entries_org_id_id_unique").on(table.orgId, table.id),
    uniqueIndex("journal_entries_org_document_kind_idx").on(
      table.orgId,
      table.documentType,
      table.documentId,
      table.kind,
    ),
    uniqueIndex("journal_entries_org_reverses_entry_idx")
      .on(table.orgId, table.reversesEntryId)
      .where(sql`${table.reversesEntryId} is not null`),
    index("journal_entries_org_date_idx").on(table.orgId, table.entryDate),
    check("journal_entries_kind_check", sql`${table.kind} in ('post', 'reverse')`),
  ],
);
