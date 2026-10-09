import { pgTable, text, timestamp, jsonb, index, bigint, boolean } from "drizzle-orm/pg-core";

type PostedDocument =
  | "receipt"
  | "payment"
  | "invoice"
  | "bill"
  | "creditNote"
  | "debitNote"
  | "journal"
  | "openingBalance";

/** Every action the audit trail records. The settings page labels each one. */
export type AuditAction =
  | `${PostedDocument}.${"post" | "cancel"}`
  | `${"invoice" | "bill"}.amend`
  | "account.setActive"
  | "allocation.apply"
  | "allocation.reverse"
  | "file.delete"
  | "file.read"
  | "file.upload"
  | "import.commit"
  | "lock.grantException"
  | "lock.revokeException"
  | "lock.set"
  | "member.invite"
  | "member.invite.revoke"
  | "member.join"
  | "member.remove"
  | "member.role.update"
  | "organization.create"
  | "rbac.permission"
  | "settings.update";

type AuditValue =
  | string
  | number
  | boolean
  | null
  | readonly AuditValue[]
  | { [key: string]: AuditValue | undefined };

// No FK to organization: entries must outlive the org, keeping their orgId.
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    action: text("action").$type<AuditAction>().notNull(),
    denied: boolean("denied").default(false).notNull(),
    actorId: text("actor_id").notNull(),
    orgId: text("org_id").notNull(),
    target: text("target"),
    meta: jsonb("meta").$type<Record<string, AuditValue>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  // The id is insertion-ordered, so it is both the keyset cursor and the sort key.
  (table) => [index("audit_log_org_id_idx").on(table.orgId, table.id)],
);
