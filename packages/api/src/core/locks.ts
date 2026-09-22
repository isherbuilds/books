import type { DbTransaction } from "@accly/db";
import type { organizationSettings } from "@accly/db/schema/organization-settings";
import { lockExceptions } from "@accly/db/schema/period-locks";
import { and, eq, gt, isNull, sql } from "drizzle-orm";

import { formatBusinessDate } from "../lib/business-date";
import { badRequest } from "../lib/conflict";
import type { Scope } from "../lib/procedures/factory";

/**
 * The caller reads settings FOR SHARE (or stronger) in this transaction before
 * any document locks. lock.set updates that row; revoke holds it FOR UPDATE.
 * Both therefore wait until every passed check commits. Expiry uses the database
 * statement clock, not the transaction start before a possible lock wait.
 */
export async function assertPeriodOpen(
  tx: DbTransaction,
  scope: Scope,
  settings: Pick<typeof organizationSettings.$inferSelect, "lockedThrough" | "taxLockedThrough">,
  args: { entryDate: string; affectsTax: boolean },
): Promise<void> {
  const { lockedThrough, taxLockedThrough } = settings;

  if (args.affectsTax && taxLockedThrough !== null && args.entryDate <= taxLockedThrough) {
    throw badRequest(
      "LOCKED",
      `The tax period is locked through ${formatBusinessDate(taxLockedThrough)}.`,
    );
  }

  if (lockedThrough === null || args.entryDate > lockedThrough) return;

  const [exception] = await tx
    .select({ id: lockExceptions.id })
    .from(lockExceptions)
    .where(
      and(
        eq(lockExceptions.orgId, scope.orgId),
        eq(lockExceptions.userId, scope.userId),
        isNull(lockExceptions.revokedAt),
        gt(lockExceptions.expiresAt, sql`statement_timestamp()`),
      ),
    )
    .limit(1);

  if (!exception) {
    throw badRequest(
      "LOCKED",
      `Books are locked through ${formatBusinessDate(lockedThrough)}. Ask for an exception to post on or before that date.`,
    );
  }
}
