import { sql } from "drizzle-orm";
import { bigint, check, date, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { organization, user } from "./auth";

export const LOCK_KINDS = ["general", "tax"] as const;

export type LockKind = (typeof LOCK_KINDS)[number];

// Append-only history. Settings own the current dates; the identity orders the
// latest change metadata per Organization and kind without application clocks.
export const periodLocks = pgTable(
  "period_locks",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: LOCK_KINDS }).notNull(),
    lockedThrough: date("locked_through", { mode: "string" }),
    reason: text("reason").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("period_locks_org_kind_id_idx").on(table.orgId, table.kind, table.id),
    check("period_locks_kind_check", sql`${table.kind} in ('general', 'tax')`),
  ],
);

export const lockExceptions = pgTable(
  "lock_exceptions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    grantedBy: text("granted_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: text("revoked_by").references(() => user.id),
  },
  (table) => [
    index("lock_exceptions_org_user_expires_idx").on(table.orgId, table.userId, table.expiresAt),
    check(
      "lock_exceptions_revoked_check",
      sql`(${table.revokedAt} is null) = (${table.revokedBy} is null)`,
    ),
  ],
);
