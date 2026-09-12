import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";

export const PARTY_ROLES = [
  "customer",
  "vendor",
  "tenant",
  "donor",
  "employee",
  "government",
] as const;

export type PartyRole = (typeof PARTY_ROLES)[number];

export const parties = pgTable(
  "parties",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    roles: text("roles").array().notNull(),
    gstin: text("gstin"),
    pan: text("pan"),
    addressLine1: text("address_line_1"),
    addressLine2: text("address_line_2"),
    city: text("city"),
    stateCode: text("state_code").notNull(),
    pinCode: text("pin_code"),
    email: text("email"),
    phone: text("phone"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "parties_roles_check",
      sql`${table.roles} <@ array['customer', 'vendor', 'tenant', 'donor', 'employee', 'government']::text[]`,
    ),
    check("parties_state_code_check", sql`char_length(${table.stateCode}) = 2`),
    unique("parties_org_id_id_unique").on(table.orgId, table.id),
    index("parties_org_normalized_name_idx").on(table.orgId, table.normalizedName),
    index("parties_org_name_idx").on(table.orgId, table.name),
    uniqueIndex("parties_org_gstin_idx")
      .on(table.orgId, table.gstin)
      .where(sql`${table.gstin} is not null`),
  ],
);
