import { db } from "@accly/db";
import { member, user } from "@accly/db/schema/auth";
import { organizationSettings } from "@accly/db/schema/organization-settings";
import { LOCK_KINDS, lockExceptions, periodLocks } from "@accly/db/schema/period-locks";
import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { audit } from "../audit";
import { badRequest, impossible } from "../lib/conflict";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { dateOnly, reason } from "../lib/schemas";
import { orgSettings } from "../lib/settlements";

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
          createdAt: lockExceptions.createdAt,
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
      const lockedThroughColumn =
        input.kind === "general"
          ? organizationSettings.lockedThrough
          : organizationSettings.taxLockedThrough;

      // UPDATE itself waits for in-flight postings holding settings FOR SHARE.
      const [settings] = await tx
        .update(organizationSettings)
        .set(
          input.kind === "general"
            ? { lockedThrough: input.lockedThrough }
            : { taxLockedThrough: input.lockedThrough },
        )
        .where(
          and(
            eq(organizationSettings.orgId, scope.orgId),
            sql`${lockedThroughColumn} is not distinct from ${input.expectedLockedThrough}`,
          ),
        )
        .returning({ orgId: organizationSettings.orgId });

      if (!settings) {
        throw new ORPCError("CONFLICT", {
          message: "This lock changed after you opened it.",
        });
      }

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
      target: String(row.id),
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
      expiresAt: z.iso.datetime({ precision: 3 }),
      reason,
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    // A grant only widens what is allowed, so it needs no mutex: a posting refused a
    // moment earlier was rightly refused. The clock is the database's, as everywhere
    // an exception is judged.
    const [membership] = await db
      .select({
        expiresAhead: sql<boolean>`${input.expiresAt}::timestamptz > statement_timestamp()`,
      })
      .from(member)
      .where(and(eq(member.organizationId, scope.orgId), eq(member.userId, input.userId)))
      .limit(1);

    if (!membership) {
      throw badRequest("MEMBER_INVALID", "Choose a member of this organization.");
    }

    if (!membership.expiresAhead) {
      throw badRequest("EXPIRY_PAST", "Choose an expiry in the future.");
    }

    const id = Bun.randomUUIDv7();

    const [row] = await db
      .insert(lockExceptions)
      .values({
        id,
        orgId: scope.orgId,
        userId: input.userId,
        expiresAt: new Date(input.expiresAt),
        reason: input.reason,
        grantedBy: scope.userId,
      })
      .returning({ id: lockExceptions.id });

    if (!row) throw impossible("lock exception insert returned no row");

    audit({
      action: "lock.grantException",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: id,
      meta: {
        userId: input.userId,
        expiresAt: input.expiresAt,
        reason: input.reason,
      },
    });

    return row;
  }),

  revokeException: orgProcedure(
    { lock: ["grantException"] },
    orgInput.extend({ exceptionId: z.uuid(), reason }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    const row = await db.transaction(async (tx) => {
      await orgSettings(scope.orgId, tx, "update");

      const [revoked] = await tx
        .update(lockExceptions)
        .set({
          revokedAt: sql`statement_timestamp()`,
          revokedBy: scope.userId,
          revokeReason: input.reason,
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

      return revoked;
    });

    audit({
      action: "lock.revokeException",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: input.exceptionId,
      meta: { exceptionId: input.exceptionId, reason: input.reason },
    });

    return row;
  }),
};
