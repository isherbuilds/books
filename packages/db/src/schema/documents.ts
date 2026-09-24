import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { parties } from "./parties";
import { paymentMethods } from "./payment-methods";
import { SETTLEMENT_KINDS } from "./settlement-kinds";

export const DOCUMENT_TYPES = [
  "receipt",
  "payment",
  "invoice",
  "bill",
  "creditNote",
  "debitNote",
  "journal",
  "openingBalance",
] as const;

export const DOCUMENT_STATES = ["draft", "posted", "cancelled"] as const;

const EXPOSURE_SIDES = ["receivable", "payable"] as const;

export const ADVANCE_SUPPLY_KINDS = ["goods", "exempt", "taxableService"] as const;

const DOCUMENT_SOURCES = ["user", "opening"] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export type AdvanceSupply = (typeof ADVANCE_SUPPLY_KINDS)[number];

export type PrintSnapshot = {
  organization: {
    legalName: string;
    address: string;
    gstin: string | null;
    pan: string;
  };
  party: {
    name: string;
    address: string;
    gstin: string | null;
    pan: string | null;
  } | null;
  paymentMethod: string | null;
  lines: Array<{ description: string }>;
};

export const documents = pgTable(
  "documents",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    type: text("type", { enum: DOCUMENT_TYPES }).notNull(),
    state: text("state", { enum: DOCUMENT_STATES }).notNull(),
    number: text("number"),
    series: text("series"),
    financialYear: text("financial_year"),
    documentDate: date("document_date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }),
    placeOfSupplyStateCode: text("place_of_supply_state_code"),
    partyId: text("party_id"),
    exposureSide: text("exposure_side", { enum: EXPOSURE_SIDES }),
    settlementKind: text("settlement_kind", { enum: SETTLEMENT_KINDS }),
    advanceSupply: text("advance_supply", { enum: ADVANCE_SUPPLY_KINDS }),
    paymentMethodId: text("payment_method_id"),
    reference: text("reference"),
    narration: text("narration"),
    source: text("source", { enum: DOCUMENT_SOURCES }).notNull().default("user"),
    version: integer("version").notNull().default(1),
    totalPaise: bigint("total_paise", { mode: "bigint" }).notNull(),
    roundOffPaise: bigint("round_off_paise", { mode: "bigint" }).notNull(),
    affectsTax: boolean("affects_tax").notNull().default(false),
    printSnapshot: jsonb("print_snapshot").$type<PrintSnapshot>(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.orgId, table.partyId],
      foreignColumns: [parties.orgId, parties.id],
    }),
    foreignKey({
      columns: [table.orgId, table.paymentMethodId],
      foreignColumns: [paymentMethods.orgId, paymentMethods.id],
    }),
    unique("documents_org_id_id_unique").on(table.orgId, table.id),
    uniqueIndex("documents_org_number_idx")
      .on(table.orgId, table.type, table.financialYear, table.number)
      .where(sql`${table.number} is not null`),
    // One posted Opening Balance per Organization.
    uniqueIndex("documents_org_opening_balance_idx")
      .on(table.orgId)
      .where(sql`${table.type} = 'openingBalance' and ${table.state} = 'posted'`),
    index("documents_org_type_date_idx").on(table.orgId, table.type, table.documentDate),
    // The newest-first keyset of each document list, without filtering type on the heap.
    index("documents_org_type_id_idx").on(table.orgId, table.type, table.id),
    index("documents_org_party_idx").on(table.orgId, table.partyId),
    // receipt.partyTotals reads only this index: one ordered, index-only scan per
    // organization instead of filtering every document on the heap.
    index("documents_posted_receipt_party_idx")
      .on(table.orgId, table.partyId, table.totalPaise)
      .where(
        sql`${table.type} = 'receipt' and ${table.state} = 'posted' and ${table.partyId} is not null`,
      ),
    check(
      "documents_type_check",
      sql`${table.type} in ('receipt', 'payment', 'invoice', 'bill', 'creditNote', 'debitNote', 'journal', 'openingBalance')`,
    ),
    check("documents_state_check", sql`${table.state} in ('draft', 'posted', 'cancelled')`),
    // The number format (GST Rules 46 and 50) and the advance supply values follow tax
    // law, so postNumbered and the receipt input enforce them, not a CHECK.
    check(
      "documents_exposure_side_check",
      sql`${table.exposureSide} is null or ${table.exposureSide} in ('receivable', 'payable')`,
    ),
    check(
      "documents_settlement_kind_check",
      sql`${table.settlementKind} is null or ${table.settlementKind} in ('against', 'advance', 'direct')`,
    ),
    check(
      "documents_advance_supply_check",
      sql`case when ${table.type} = 'receipt' and ${table.settlementKind} = 'advance' then ${table.advanceSupply} is not null when ${table.type} = 'receipt' and ${table.settlementKind} = 'against' then true else ${table.advanceSupply} is null end`,
    ),
    check("documents_source_check", sql`${table.source} in ('user', 'opening')`),
    check("documents_total_paise_check", sql`${table.totalPaise} >= 0`),
  ],
);
