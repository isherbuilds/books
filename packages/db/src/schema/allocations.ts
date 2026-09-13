import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { documents } from "./documents";
import { organization } from "./auth";

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
    state: text("state", { enum: ["active", "reversed"] })
      .notNull()
      .default("active"),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
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
    unique("allocations_org_id_id_unique").on(table.orgId, table.id),
    index("allocations_org_source_document_idx").on(table.orgId, table.sourceDocumentId),
    index("allocations_org_target_document_idx").on(table.orgId, table.targetDocumentId),
    check("allocations_amount_paise_check", sql`${table.amountPaise} > 0`),
    check("allocations_state_check", sql`${table.state} in ('active', 'reversed')`),
  ],
);
