import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { opdAppointments } from "./opd-appointments";
import { customers } from "./customers";

// Immutable: issuance is the only write, and credit notes are the only correction
// path. Print fields are snapshots, so later profile edits cannot alter the document.
export const invoices = pgTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    opdAppointmentId: text("opd_appointment_id").notNull(),
    customerId: text("customer_id").notNull(),
    invoiceNumber: text("invoice_number").notNull(),
    fiscalYear: text("fiscal_year").notNull(),
    businessDate: date("business_date").notNull(),
    discountAmount: bigint("discount_amount", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    // Internal, and deliberately not printed, so the desk can write plainly. Required
    // by the app whenever there is a discount or an unpaid departure.
    note: text("note"),
    subtotal: bigint("subtotal", { mode: "bigint" }).notNull(),
    taxTotal: bigint("tax_total", { mode: "bigint" }).notNull(),
    grandTotal: bigint("grand_total", { mode: "bigint" }).notNull(),
    orgLegalName: text("org_legal_name").notNull(),
    orgAddress: text("org_address").notNull(),
    orgTaxId: text("org_tax_id").notNull(),
    currency: text("currency").notNull(),
    customerName: text("customer_name").notNull(),
    customerCode: text("customer_code").notNull(),
    customerPhone: text("customer_phone").notNull(),
    customerAddress: text("customer_address"),
    issuedBy: text("issued_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("invoices_discount_amount_check", sql`${table.discountAmount} >= 0`),
    check("invoices_subtotal_check", sql`${table.subtotal} >= 0`),
    check("invoices_tax_total_check", sql`${table.taxTotal} >= 0`),
    check("invoices_grand_total_check", sql`${table.grandTotal} >= 0`),
    check(
      "invoices_discount_not_above_subtotal_check",
      sql`${table.discountAmount} <= ${table.subtotal}`,
    ),
    check(
      "invoices_total_math_check",
      sql`${table.grandTotal} = ${table.subtotal} - ${table.discountAmount} + ${table.taxTotal}`,
    ),
    unique("invoices_org_id_id_unique").on(table.orgId, table.id),
    uniqueIndex("invoices_org_number_idx").on(table.orgId, table.invoiceNumber),
    foreignKey({
      columns: [table.orgId, table.opdAppointmentId],
      foreignColumns: [opdAppointments.orgId, opdAppointments.id],
    }),
    foreignKey({
      columns: [table.orgId, table.customerId],
      foreignColumns: [customers.orgId, customers.id],
    }),
    index("invoices_org_opd_appointment_idx").on(
      table.orgId,
      table.opdAppointmentId,
      table.createdAt,
    ),
    index("invoices_org_business_date_idx").on(table.orgId, table.businessDate),
    // Ascending: the worklist reads oldest-first, and a DESC index cannot serve an ASC
    // scan without the same NULLS trap as file.ts.
    index("invoices_org_created_idx").on(table.orgId, table.createdAt, table.id),
  ],
);
