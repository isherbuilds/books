import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, pgTable, text, unique } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { documents } from "./documents";
import { tdsSections } from "./tds-sections";

// The compliance fact a journal line cannot hold: the section, and a deduction that
// rounds to zero (a zero journal line is refused). The TDS Payable leg itself stays an
// ordinary journal line. Slice 4 adds a document-bound line reference for Bill lines.
export const tdsDeductions = pgTable(
  "tds_deductions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    documentId: text("document_id").notNull(),
    tdsSectionId: text("tds_section_id").notNull(),
    amountPaise: bigint("amount_paise", { mode: "bigint" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.orgId, table.documentId],
      foreignColumns: [documents.orgId, documents.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.orgId, table.tdsSectionId],
      foreignColumns: [tdsSections.orgId, tdsSections.id],
    }),
    unique("tds_deductions_org_document_unique").on(table.orgId, table.documentId),
    check("tds_deductions_amount_paise_check", sql`${table.amountPaise} >= 0`),
  ],
);
