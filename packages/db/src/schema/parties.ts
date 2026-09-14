import { sql } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

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
    roles: text("roles").array().$type<PartyRole[]>().notNull(),
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
    // Millisecond precision: the value round-trips through JSON as the edit token.
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
  },
  // Roles, state codes and one-Party-per-GSTIN are application rules (routers/party.ts):
  // GST practice can change them, so no CHECK or unique index repeats them.
  (table) => [
    unique("parties_org_id_id_unique").on(table.orgId, table.id),
    index("parties_org_normalized_name_idx").on(table.orgId, table.normalizedName),
    index("parties_org_name_idx").on(table.orgId, table.name),
    index("parties_org_gstin_idx")
      .on(table.orgId, table.gstin)
      .where(sql`${table.gstin} is not null`),
  ],
);
