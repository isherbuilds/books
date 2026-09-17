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
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { documents } from "./documents";
import { organization, user } from "./auth";

export const allocations = pgTable(
  "allocations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sourceDocumentId: text("source_document_id").notNull(),
    targetDocumentId: text("target_document_id").notNull(),
    amountPaise: bigint("amount_paise", { mode: "bigint" }).notNull(),
    kind: text("kind", { enum: ["apply", "reverse"] }).notNull(),
    reversesAllocationId: text("reverses_allocation_id"),
    entryDate: date("entry_date", { mode: "string" }).notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.orgId, table.sourceDocumentId],
      foreignColumns: [documents.orgId, documents.id],
    }),
    foreignKey({
      columns: [table.orgId, table.targetDocumentId],
      foreignColumns: [documents.orgId, documents.id],
    }),
    foreignKey({
      columns: [table.orgId, table.reversesAllocationId],
      foreignColumns: [table.orgId, table.id],
      name: "allocations_reverses_fk",
    }),
    unique("allocations_org_id_id_unique").on(table.orgId, table.id),
    index("allocations_org_source_document_idx").on(table.orgId, table.sourceDocumentId),
    index("allocations_org_target_document_idx").on(table.orgId, table.targetDocumentId),
    uniqueIndex("allocations_org_reverses_idx")
      .on(table.orgId, table.reversesAllocationId)
      .where(sql`${table.reversesAllocationId} is not null`),
    check("allocations_amount_paise_check", sql`${table.amountPaise} > 0`),
    check("allocations_kind_check", sql`${table.kind} in ('apply', 'reverse')`),
  ],
);
