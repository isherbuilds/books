import {
  check,
  boolean,
  date,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { organization, user } from "./auth";

export const customers = pgTable(
  "customers",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    sex: text("sex", { enum: ["male", "female", "other", "unknown"] }).notNull(),
    dateOfBirth: date("date_of_birth", { mode: "string" }).notNull(),
    dobEstimated: boolean("dob_estimated").default(false).notNull(),
    // Callers pass "" when not provided; no null semantics downstream.
    address: text("address").notNull(),
    email: text("email"),
    uid: text("uid"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    check("customers_sex_check", sql`${table.sex} in ('male', 'female', 'other', 'unknown')`),
    unique("customers_org_id_id_unique").on(table.orgId, table.id),
    uniqueIndex("customers_org_code_idx").on(table.orgId, table.code),
    uniqueIndex("customers_org_uid_idx")
      .on(table.orgId, table.uid)
      .where(sql`${table.uid} is not null`),
  ],
);
