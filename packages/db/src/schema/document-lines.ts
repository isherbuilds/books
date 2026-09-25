import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
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

export const ADJUSTMENT_KINDS = ["fee", "writeOff", "tds"] as const;

export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

export type EntrySide = (typeof ENTRY_SIDES)[number];

export const documentLines = pgTable(
  "document_lines",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    documentId: text("document_id").notNull(),
    sourceLineId: text("source_line_id"),
    position: integer("position").notNull(),
    kind: text("kind", { enum: ["item", "account"] }).notNull(),
    accountId: text("account_id"),
    entrySide: text("entry_side", { enum: ENTRY_SIDES }),
    adjustmentKind: text("adjustment_kind", { enum: ADJUSTMENT_KINDS }),
    itemId: text("item_id"),
    partyId: text("party_id"),
    description: text("description").notNull(),
    hsnSac: text("hsn_sac"),
    unit: text("unit"),
    quantity: integer("quantity"),
    unitPricePaise: bigint("unit_price_paise", { mode: "bigint" }),
    taxRateId: text("tax_rate_id"),
    itcEligible: boolean("itc_eligible"),
    cgstPaise: bigint("cgst_paise", { mode: "bigint" }).notNull(),
    sgstPaise: bigint("sgst_paise", { mode: "bigint" }).notNull(),
    igstPaise: bigint("igst_paise", { mode: "bigint" }).notNull(),
    amountPaise: bigint("amount_paise", { mode: "bigint" }).notNull(),
    discountPaise: bigint("discount_paise", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
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
    foreignKey({
      columns: [table.orgId, table.sourceLineId],
      foreignColumns: [table.orgId, table.id],
    }),
    unique("document_lines_org_id_id_unique").on(table.orgId, table.id),
    index("document_lines_org_document_idx").on(table.orgId, table.documentId),
    index("document_lines_org_source_line_idx").on(table.orgId, table.sourceLineId),
    check("document_lines_kind_check", sql`${table.kind} in ('item', 'account')`),
    check(
      "document_lines_entry_side_check",
      sql`${table.entrySide} is null or ${table.entrySide} in ('debit', 'credit')`,
    ),
    check(
      "document_lines_adjustment_kind_check",
      sql`${table.adjustmentKind} is null or ${table.adjustmentKind} in ('fee', 'writeOff', 'tds')`,
    ),
    check(
      "document_lines_quantity_check",
      sql`${table.quantity} is null or ${table.quantity} >= 1`,
    ),
    check("document_lines_cgst_paise_check", sql`${table.cgstPaise} >= 0`),
    check("document_lines_sgst_paise_check", sql`${table.sgstPaise} >= 0`),
    check("document_lines_igst_paise_check", sql`${table.igstPaise} >= 0`),
    check("document_lines_discount_paise_check", sql`${table.discountPaise} >= 0`),
  ],
);
