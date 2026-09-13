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

export const EXPOSURE_SIDES = ["receivable", "payable"] as const;

export const SETTLEMENT_KINDS = ["against", "advance", "direct"] as const;

export const ADVANCE_SUPPLY_KINDS = ["goods", "exempt", "taxableService"] as const;

export const DOCUMENT_SOURCES = ["user", "opening"] as const;

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
  } | null;
  paymentMethod: string | null;
  lines: Array<{
    description: string;
    hsnSac: string | null;
    unit: string | null;
  }>;
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
    index("documents_org_type_date_idx").on(table.orgId, table.type, table.documentDate),
    // The newest-first keyset of each document list, without filtering type on the heap.
    index("documents_org_type_id_idx").on(table.orgId, table.type, table.id),
    index("documents_org_party_idx").on(table.orgId, table.partyId),
    check(
      "documents_type_check",
      sql`${table.type} in ('receipt', 'payment', 'invoice', 'bill', 'creditNote', 'debitNote', 'journal', 'openingBalance')`,
    ),
    check("documents_state_check", sql`${table.state} in ('draft', 'posted', 'cancelled')`),
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
      sql`coalesce(${table.settlementKind} = 'advance', false) = (${table.advanceSupply} is not null)
        and (${table.advanceSupply} is null or ${table.advanceSupply} in ('goods', 'exempt', 'taxableService'))`,
    ),
    check("documents_source_check", sql`${table.source} in ('user', 'opening')`),
    check("documents_total_paise_check", sql`${table.totalPaise} >= 0`),
  ],
);
