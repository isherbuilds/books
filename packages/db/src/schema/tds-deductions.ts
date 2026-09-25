import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, pgTable, text, unique } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { documents } from "./documents";
import { tdsSections } from "./tds-sections";

// The compliance fact a journal line cannot hold: the section, the base the rate
// applied to, and a deduction that rounds to zero (a zero journal line is refused).
// The TDS Payable leg itself stays an ordinary journal line. A Payment's base is its
// gross amount; a Bill's is its taxable total, GST excluded.
export const tdsDeductions = pgTable(
  "tds_deductions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    documentId: text("document_id").notNull(),
    tdsSectionId: text("tds_section_id").notNull(),
    basePaise: bigint("base_paise", { mode: "bigint" }).notNull(),
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
    check("tds_deductions_base_paise_check", sql`${table.basePaise} > 0`),
    check("tds_deductions_amount_paise_check", sql`${table.amountPaise} >= 0`),
  ],
);
