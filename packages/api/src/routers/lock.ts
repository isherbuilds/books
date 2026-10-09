import { db } from "@accly/db";
import { member, user } from "@accly/db/schema/auth";
import { organizationSettings } from "@accly/db/schema/organization-settings";
import { lockExceptions, periodLocks } from "@accly/db/schema/period-locks";
import { LOCK_KINDS } from "@accly/db/schema/lock-kinds";
import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { audit } from "@accly/db/audit";
import { badRequest, impossible } from "../lib/conflict";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { dateOnly, LOCK_EXCEPTION_DAYS, reason } from "../lib/schemas";
import { orgSettings } from "../lib/org-settings";

const exceptionUser = alias(user, "exception_user");

const exceptionGranter = alias(user, "exception_granter");

export const lockRouter = {
  get: orgProcedure({ lock: ["read"] }, orgInput).handler(async ({ context }) => {
    const { orgId } = context.scope;

    const [locks, exceptions] = await Promise.all([
      db
        .selectDistinctOn([periodLocks.kind], {
          kind: periodLocks.kind,
          lockedThrough: periodLocks.lockedThrough,
          reason: periodLocks.reason,
          setBy: { name: user.name },
          setAt: periodLocks.createdAt,
        })
        .from(periodLocks)
        .innerJoin(user, eq(user.id, periodLocks.createdBy))
        .where(eq(periodLocks.orgId, orgId))
        .orderBy(periodLocks.kind, desc(periodLocks.id)),
      db
        .select({
          id: lockExceptions.id,
          userId: lockExceptions.userId,
          user: { name: exceptionUser.name, email: exceptionUser.email },
          expiresAt: lockExceptions.expiresAt,
          reason: lockExceptions.reason,
          grantedBy: { name: exceptionGranter.name },
        })
        .from(lockExceptions)
        .innerJoin(exceptionUser, eq(exceptionUser.id, lockExceptions.userId))
        .innerJoin(exceptionGranter, eq(exceptionGranter.id, lockExceptions.grantedBy))
        .where(
          and(
            eq(lockExceptions.orgId, orgId),
            isNull(lockExceptions.revokedAt),
            gt(lockExceptions.expiresAt, sql`statement_timestamp()`),
          ),
        )
        .orderBy(asc(lockExceptions.expiresAt)),
    ]);

    return {
      general: locks.find((lock) => lock.kind === "general") ?? null,
      tax: locks.find((lock) => lock.kind === "tax") ?? null,
      exceptions,
    };
  }),

  set: orgProcedure(
    { lock: ["set"] },
    orgInput.extend({
      kind: z.enum(LOCK_KINDS),
      lockedThrough: dateOnly.nullable(),
      expectedLockedThrough: dateOnly.nullable(),
      reason,
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    const row = await db.transaction(async (tx) => {
      const settings = await orgSettings(scope.orgId, tx, "update");

      const currentLockedThrough =
        input.kind === "general" ? settings.lockedThrough : settings.taxLockedThrough;

      if (currentLockedThrough !== input.expectedLockedThrough) {
        throw new ORPCError("CONFLICT", {
          message: "This lock changed after you opened it.",
        });
      }

      await tx
        .update(organizationSettings)
        .set(
          input.kind === "general"
            ? { lockedThrough: input.lockedThrough }
            : { taxLockedThrough: input.lockedThrough },
        )
        .where(eq(organizationSettings.orgId, scope.orgId));

      const [inserted] = await tx
        .insert(periodLocks)
        .values({
          orgId: scope.orgId,
          kind: input.kind,
          lockedThrough: input.lockedThrough,
          reason: input.reason,
          createdBy: scope.userId,
        })
        .returning({ id: periodLocks.id, lockedThrough: periodLocks.lockedThrough });

      if (!inserted) throw impossible("lock insert returned no row");

      return inserted;
    });

    audit({
      action: "lock.set",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `periodLock:${row.id}`,
      meta: {
        kind: input.kind,
        lockedThrough: input.lockedThrough,
        reason: input.reason,
      },
    });

    return { lockedThrough: row.lockedThrough };
  }),

  grantException: orgProcedure(
    { lock: ["grantException"] },
    orgInput.extend({
      userId: z.string().min(1),
      days: z.literal(LOCK_EXCEPTION_DAYS),
      reason,
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    // Serialize grants with revokes and other grants before testing for an active
    // exception; a second concurrent grant must not create a second live bypass.
    const row = await db.transaction(async (tx) => {
      await orgSettings(scope.orgId, tx, "update");

      const [grantee] = await tx
        .select({ name: user.name, email: user.email })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(and(eq(member.organizationId, scope.orgId), eq(member.userId, input.userId)))
        .limit(1);

      if (!grantee) {
        throw badRequest("MEMBER_INVALID", "Choose a member of this organization.");
      }

      const [active] = await tx
        .select({ id: lockExceptions.id })
        .from(lockExceptions)
        .where(
          and(
            eq(lockExceptions.orgId, scope.orgId),
            eq(lockExceptions.userId, input.userId),
            isNull(lockExceptions.revokedAt),
            gt(lockExceptions.expiresAt, sql`statement_timestamp()`),
          ),
        )
        .limit(1);

      if (active) {
        throw badRequest("EXCEPTION_ACTIVE", "This member already has an active exception.");
      }

      const [inserted] = await tx
        .insert(lockExceptions)
        .values({
          id: Bun.randomUUIDv7(),
          orgId: scope.orgId,
          userId: input.userId,
          expiresAt: sql`statement_timestamp() + make_interval(days => ${input.days})`,
          reason: input.reason,
          grantedBy: scope.userId,
          createdAt: sql`statement_timestamp()`,
        })
        .returning({ id: lockExceptions.id });

      if (!inserted) throw impossible("lock exception insert returned no row");

      return { ...inserted, grantee };
    });

    audit({
      action: "lock.grantException",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `lockException:${row.id}`,
      meta: {
        userId: input.userId,
        name: row.grantee.name,
        email: row.grantee.email,
        days: input.days,
        reason: input.reason,
      },
    });

    return { id: row.id };
  }),

  revokeException: orgProcedure(
    { lock: ["grantException"] },
    orgInput.extend({ exceptionId: z.uuid() }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    await db.transaction(async (tx) => {
      await orgSettings(scope.orgId, tx, "update");

      const [revoked] = await tx
        .update(lockExceptions)
        .set({
          revokedAt: sql`statement_timestamp()`,
          revokedBy: scope.userId,
        })
        .where(
          and(
            eq(lockExceptions.orgId, scope.orgId),
            eq(lockExceptions.id, input.exceptionId),
            isNull(lockExceptions.revokedAt),
            gt(lockExceptions.expiresAt, sql`statement_timestamp()`),
          ),
        )
        .returning({ id: lockExceptions.id });

      if (!revoked) {
        throw new ORPCError("CONFLICT", { message: "This exception is not active." });
      }
    });
    audit({
      action: "lock.revokeException",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `lockException:${input.exceptionId}`,
    });
  }),
};
