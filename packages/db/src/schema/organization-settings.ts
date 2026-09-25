import { check, date, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { organization } from "./auth";

// The application owns this list (zod in createOrganizationInput); no CHECK repeats it.
export const LEGAL_TYPES = [
  "individual",
  "proprietorship",
  "partnership",
  "llp",
  "company",
  "trust",
  "society",
] as const;

export type LegalType = (typeof LEGAL_TYPES)[number];

// One row per Organization owns legal identity and operational settings.
export const SETTINGS_DEFAULTS = {
  timeZone: "Asia/Kolkata",
  financialYearStart: 4,
  invoicePrefix: "INV",
  billPrefix: "BILL",
  receiptPrefix: "RCT",
  paymentPrefix: "PMT",
  creditNotePrefix: "CN",
  debitNotePrefix: "DN",
  journalPrefix: "JV",
} as const;

export const organizationSettings = pgTable(
  "organization_settings",
  {
    orgId: text("org_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    legalType: text("legal_type", { enum: LEGAL_TYPES }).notNull(),
    legalName: text("legal_name").notNull(),
    pan: text("pan").notNull(),
    gstin: text("gstin"),
    stateCode: text("state_code").notNull(),
    financialYearStart: integer("financial_year_start")
      .notNull()
      .default(SETTINGS_DEFAULTS.financialYearStart),
    addressLine1: text("address_line_1").notNull(),
    addressLine2: text("address_line_2"),
    city: text("city").notNull(),
    pinCode: text("pin_code").notNull(),
    invoicePrefix: text("invoice_prefix").notNull(),
    billPrefix: text("bill_prefix").notNull(),
    receiptPrefix: text("receipt_prefix").notNull(),
    paymentPrefix: text("payment_prefix").notNull(),
    creditNotePrefix: text("credit_note_prefix").notNull(),
    debitNotePrefix: text("debit_note_prefix").notNull(),
    journalPrefix: text("journal_prefix").notNull(),
    // SETTINGS_DEFAULTS is the application source for new rows.
    timeZone: text("time_zone").notNull().default("Asia/Kolkata"),
    lockedThrough: date("locked_through", { mode: "string" }),
    taxLockedThrough: date("tax_locked_through", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "organization_settings_financial_year_start_check",
      sql`${table.financialYearStart} between 1 and 12`,
    ),
  ],
);
