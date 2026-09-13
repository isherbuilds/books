import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
} from "drizzle-orm/pg-core";

import { accounts } from "./accounts";
import { organization } from "./auth";
import { documents } from "./documents";

export const documentLines = pgTable(
  "document_lines",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    documentId: text("document_id").notNull(),
    position: integer("position").notNull(),
    kind: text("kind", { enum: ["item", "account"] }).notNull(),
    accountId: text("account_id"),
    description: text("description").notNull(),
    amountPaise: bigint("amount_paise", { mode: "bigint" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.orgId, table.documentId],
      foreignColumns: [documents.orgId, documents.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.orgId, table.accountId],
      foreignColumns: [accounts.orgId, accounts.id],
    }),
    unique("document_lines_org_id_id_unique").on(table.orgId, table.id),
    index("document_lines_org_document_idx").on(table.orgId, table.documentId),
    check("document_lines_kind_check", sql`${table.kind} in ('item', 'account')`),
  ],
);
