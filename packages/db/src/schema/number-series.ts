import { integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { DOCUMENT_TYPES } from "./documents";

// One counter per series: a prefix change mid-year starts a new series at 1, so
// every series stays consecutive (GST Rule 46 allows several).
export const numberSeries = pgTable(
  "number_series",
  {
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    documentType: text("document_type", { enum: DOCUMENT_TYPES }).notNull(),
    financialYear: text("financial_year").notNull(),
    prefix: text("prefix").notNull(),
    next: integer("next").notNull().default(1),
  },
  (table) => [
    primaryKey({
      columns: [table.orgId, table.documentType, table.financialYear, table.prefix],
    }),
  ],
);
