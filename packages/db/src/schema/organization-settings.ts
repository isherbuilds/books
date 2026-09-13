import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { organization } from "./auth";

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
  currency: "INR",
  timeZone: "Asia/Kolkata",
  codePrefix: "",
  invoicePrefix: "INV",
  receiptPrefix: "RCT",
  creditNotePrefix: "CN",
  followUpValidityDays: 14,
  unbilledAlertHours: 24,
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
    financialYearStart: integer("financial_year_start").notNull().default(4),
    addressLine1: text("address_line_1").notNull(),
    addressLine2: text("address_line_2"),
    city: text("city").notNull(),
    pinCode: text("pin_code").notNull(),
    currency: text("currency").notNull(),
    codePrefix: text("code_prefix").notNull(),
    invoicePrefix: text("invoice_prefix").notNull(),
    receiptPrefix: text("receipt_prefix").notNull(),
    creditNotePrefix: text("credit_note_prefix").notNull(),
    // SETTINGS_DEFAULTS is the application source for new rows.
    timeZone: text("time_zone").notNull().default("Asia/Kolkata"),
    followUpValidityDays: integer("follow_up_validity_days").notNull().default(14),
    unbilledAlertHours: integer("unbilled_alert_hours").notNull().default(24),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "organization_settings_legal_type_check",
      sql`${table.legalType} in ('individual', 'proprietorship', 'partnership', 'llp', 'company', 'trust', 'society')`,
    ),
    check("organization_settings_state_code_check", sql`char_length(${table.stateCode}) = 2`),
    check(
      "organization_settings_financial_year_start_check",
      sql`${table.financialYearStart} between 1 and 12`,
    ),
    check(
      "organization_settings_follow_up_days_check",
      sql`${table.followUpValidityDays} between 1 and 365`,
    ),
    check(
      "organization_settings_unbilled_alert_hours_check",
      sql`${table.unbilledAlertHours} between 1 and 168`,
    ),
  ],
);
