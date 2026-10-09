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
  "openingClaim",
  "openingCredit",
] as const;

export const DOCUMENT_STATES = ["draft", "posted", "cancelled"] as const;

const EXPOSURE_SIDES = ["receivable", "payable"] as const;

export const ADVANCE_SUPPLY_KINDS = ["goods", "exempt", "taxableService"] as const;

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
    /** The recipient's state, printed with its name and code (CGST rule 46). */
    stateCode: string;
    gstin: string | null;
    pan: string | null;
  } | null;
  paymentMethod: string | null;
  lines: Array<{ description: string }>;
  /** An Invoice's address of delivery when it differs (CGST rule 46(o)); print-only. */
  shipTo?: { address: string; stateCode: string };
  /** An Invoice discount entered as a percentage, so the print can say "Discount (10%)". */
  discountBasisPoints?: number;
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
    financialYear: text("financial_year"),
    documentDate: date("document_date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }),
    placeOfSupplyStateCode: text("place_of_supply_state_code"),
    intraState: boolean("intra_state"),
    partyId: text("party_id"),
    amendedFromId: text("amended_from_id"),
    againstDocumentId: text("against_document_id"),
    exposureSide: text("exposure_side", { enum: EXPOSURE_SIDES }),
    settlementKind: text("settlement_kind", { enum: SETTLEMENT_KINDS }),
    advanceSupply: text("advance_supply", { enum: ADVANCE_SUPPLY_KINDS }),
    paymentMethodId: text("payment_method_id"),
    reference: text("reference"),
    narration: text("narration"),
    version: integer("version").notNull().default(1),
    totalPaise: bigint("total_paise", { mode: "bigint" }).notNull(),
    discountPaise: bigint("discount_paise", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    roundOffPaise: bigint("round_off_paise", { mode: "bigint" }).notNull(),
    affectsTax: boolean("affects_tax").notNull().default(false),
    printSnapshot: jsonb("print_snapshot").$type<PrintSnapshot>(),
    // What register and palette search match: number, reference, narration and the
    // printed party name. One trigram index serves a substring anywhere in it.
    searchText: text("search_text").generatedAlwaysAs(
      sql`coalesce(number, '') || ' ' || coalesce(reference, '') || ' ' || coalesce(narration, '') || ' ' || coalesce(print_snapshot->'party'->>'name', '')`,
    ),
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
    foreignKey({
      columns: [table.orgId, table.amendedFromId],
      foreignColumns: [table.orgId, table.id],
    }),
    foreignKey({
      columns: [table.orgId, table.againstDocumentId],
      foreignColumns: [table.orgId, table.id],
    }),
    unique("documents_org_id_id_unique").on(table.orgId, table.id),
    uniqueIndex("documents_org_number_idx")
      .on(table.orgId, table.type, table.financialYear, table.number)
      .where(sql`${table.number} is not null`),
    // One posted Opening Balance per Organization.
    uniqueIndex("documents_org_opening_balance_idx")
      .on(table.orgId)
      .where(sql`${table.type} = 'openingBalance' and ${table.state} = 'posted'`),
    // Register periods and newest-first (document date, id) keysets share this index.
    // The trailing columns follow the unique id, so they never change the order; they
    // let register totals sum by state, party and payment method from the index alone.
    index("documents_org_type_date_id_idx").on(
      table.orgId,
      table.type,
      table.documentDate,
      table.id,
      table.state,
      table.totalPaise,
      table.partyId,
      table.paymentMethodId,
    ),
    // A supplier invoice number posts once per supplier and financial year (D5).
    // Cancelling releases it; drafts are unchecked.
    uniqueIndex("documents_bill_reference_idx")
      .on(table.orgId, table.partyId, table.financialYear, sql`lower(${table.reference})`)
      .where(sql`${table.type} = 'bill' and ${table.state} = 'posted'`),
    // party.transactions retains its creation-order id cursor.
    index("documents_org_party_idx").on(table.orgId, table.partyId, table.id),
    // Party-filtered registers seek their period and newest-first date/id keyset.
    index("documents_org_party_date_id_idx").on(
      table.orgId,
      table.partyId,
      table.documentDate,
      table.id,
    ),
    index("documents_search_text_idx").using("gin", table.searchText.op("gin_trgm_ops")),
    index("documents_org_amended_from_idx").on(table.orgId, table.amendedFromId),
    index("documents_org_against_document_idx").on(table.orgId, table.againstDocumentId),
    // receipt.partyTotals reads only this index: one ordered, index-only scan per
    // organization instead of filtering every document on the heap.
    index("documents_posted_receipt_party_idx")
      .on(table.orgId, table.partyId, table.totalPaise)
      .where(
        sql`${table.type} = 'receipt' and ${table.state} = 'posted' and ${table.partyId} is not null`,
      ),
    check(
      "documents_type_check",
      sql`${table.type} in ('receipt', 'payment', 'invoice', 'bill', 'creditNote', 'debitNote', 'journal', 'openingBalance', 'openingClaim', 'openingCredit')`,
    ),
    // An opening item is a party's exposure on one side; settlement reads both.
    check(
      "documents_opening_item_check",
      sql`${table.type} not in ('openingClaim', 'openingCredit') or (${table.partyId} is not null and ${table.exposureSide} is not null)`,
    ),
    check("documents_state_check", sql`${table.state} in ('draft', 'posted', 'cancelled')`),
    check(
      "documents_supply_type_check",
      sql`${table.type} not in ('invoice', 'bill', 'creditNote', 'debitNote') or ${table.intraState} is not null`,
    ),
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
    check("documents_total_paise_check", sql`${table.totalPaise} >= 0`),
    check("documents_discount_paise_check", sql`${table.discountPaise} >= 0`),
  ],
);
