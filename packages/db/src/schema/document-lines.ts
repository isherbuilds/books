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
import { items } from "./items";
import { parties } from "./parties";
import { taxRates } from "./tax-rates";

export const ENTRY_SIDES = ["debit", "credit"] as const;

export type EntrySide = (typeof ENTRY_SIDES)[number];

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
    entrySide: text("entry_side", { enum: ENTRY_SIDES }),
    itemId: text("item_id"),
    partyId: text("party_id"),
    description: text("description").notNull(),
    hsnSac: text("hsn_sac"),
    unit: text("unit"),
    quantity: integer("quantity"),
    unitPricePaise: bigint("unit_price_paise", { mode: "bigint" }),
    taxRateId: text("tax_rate_id"),
    cgstPaise: bigint("cgst_paise", { mode: "bigint" }).notNull(),
    sgstPaise: bigint("sgst_paise", { mode: "bigint" }).notNull(),
    igstPaise: bigint("igst_paise", { mode: "bigint" }).notNull(),
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
    foreignKey({
      columns: [table.orgId, table.itemId],
      foreignColumns: [items.orgId, items.id],
    }),
    foreignKey({
      columns: [table.orgId, table.partyId],
      foreignColumns: [parties.orgId, parties.id],
    }),
    foreignKey({
      columns: [table.orgId, table.taxRateId],
      foreignColumns: [taxRates.orgId, taxRates.id],
    }),
    unique("document_lines_org_id_id_unique").on(table.orgId, table.id),
    index("document_lines_org_document_idx").on(table.orgId, table.documentId),
    check("document_lines_kind_check", sql`${table.kind} in ('item', 'account')`),
    check(
      "document_lines_entry_side_check",
      sql`${table.entrySide} is null or ${table.entrySide} in ('debit', 'credit')`,
    ),
    check(
      "document_lines_quantity_check",
      sql`${table.quantity} is null or ${table.quantity} >= 1`,
    ),
    check("document_lines_cgst_paise_check", sql`${table.cgstPaise} >= 0`),
    check("document_lines_sgst_paise_check", sql`${table.sgstPaise} >= 0`),
    check("document_lines_igst_paise_check", sql`${table.igstPaise} >= 0`),
  ],
);
