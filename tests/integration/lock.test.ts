import { expect, test } from "bun:test";

import { drainAuditWrites } from "@accly/api/audit";
import { assertPeriodOpen } from "@accly/api/core/locks";
import type { Scope } from "@accly/api/lib/procedures/factory";
import { orgSettings } from "@accly/api/lib/settlements";
import type { AppRouterClient } from "@accly/api/routers/index";
import { db } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { auditLog } from "@accly/db/schema/audit";
import { organizationSettings } from "@accly/db/schema/organization-settings";
import { periodLocks } from "@accly/db/schema/period-locks";
import { and, eq, sql } from "drizzle-orm";

import { createAccountingFixture } from "../support/accounting";
import { required } from "../support/assert";
import { createFounderSession, createTestUser, joinOrganization } from "../support/auth";
import { clientFor, expectORPCCode, expectReason } from "../support/client";
import { resetTestDatabase } from "../support/database";

type Account = typeof accounts.$inferSelect;

const today = new Date().toISOString().slice(0, 10);

function addUtcDays(date: string, days: number): string {
  const start = new Date(`${date}T00:00:00.000Z`);

  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + days))
    .toISOString()
    .slice(0, 10);
}

const yesterday = addUtcDays(today, -1);

const tomorrow = addUtcDays(today, 1);

function lockAccountsOf(rows: Account[]) {
  const cashGroup = required(
    rows.find(({ systemKey }) => systemKey === "cash"),
    "cash group",
  );

  return {
    cash: required(
      rows.find(({ parentId, active }) => parentId === cashGroup.id && active),
      "cash account",
    ),
    exemptIncome: required(
      rows.find(
        ({ type, active, supplyClass }) => type === "income" && active && supplyClass === "exempt",
      ),
      "exempt income account",
    ),
  };
}

function postJournal(
  api: AppRouterClient,
  orgSlug: string,
  cash: Account,
  exemptIncome: Account,
  documentDate: string,
  narration: string,
) {
  return api.journal.post({
    orgSlug,
    documentDate,
    narration,
    lines: [
      { accountId: cash.id, side: "debit", amount: "1.00" },
      { accountId: exemptIncome.id, side: "credit", amount: "1.00" },
    ],
  });
}

async function lockChangeCounts(orgId: string) {
  await drainAuditWrites();

  const [[history], [audits]] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(periodLocks)
      .where(and(eq(periodLocks.orgId, orgId), eq(periodLocks.kind, "general"))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(and(eq(auditLog.orgId, orgId), eq(auditLog.action, "lock.set"))),
  ]);

  return {
    history: required(history, "general lock history count").count,
    audits: required(audits, "lock audit count").count,
  };
}

/**
 * Runs `change` while a posting holds its passed period check open in an uncommitted
 * transaction. The holder backend is captured inside that transaction, then
 * pg_blocking_pids identifies a waiter blocked by that specific backend.
 */
async function raceLockChange(
  scope: Scope,
  change: () => Promise<unknown>,
): Promise<"changed" | "waiting"> {
  const ready = Promise.withResolvers<{ holderPid: number } | { error: unknown }>();
  const release = Promise.withResolvers<void>();

  const inFlight = db
    .transaction(async (tx) => {
      const { rows } = await tx.execute<{ pid: number }>(sql`select pg_backend_pid()::int as pid`);

      const holderPid = rows[0]?.pid;

      if (holderPid === undefined) throw new Error("could not identify lock holder backend");

      const settings = await orgSettings(scope.orgId, tx);
      await assertPeriodOpen(tx, scope, settings, { entryDate: today, affectsTax: false });
      ready.resolve({ holderPid });
      await release.promise;
    })
    .then(
      () => ({ ok: true as const }),
      (error: unknown) => {
        ready.resolve({ error });

        return { ok: false as const, error };
      },
    );

  const readiness = await ready.promise;

  if ("error" in readiness) {
    release.resolve();
    await inFlight;
    throw readiness.error;
  }

  let completed = false;

  const pending = Promise.resolve()
    .then(change)
    .then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    .finally(() => {
      completed = true;
    });

  let outcome: "changed" | "waiting" | "timeout" = "timeout";
  let observationResult: { ok: true } | { ok: false; error: unknown } = { ok: true };

  try {
    const deadline = performance.now() + 1_000;

    while (performance.now() < deadline) {
      if (completed) {
        outcome = "changed";
        break;
      }

      const { rows } = await db.execute<{ blocked: boolean }>(
        sql`select exists(
          select 1
          from pg_stat_activity waiter
          where waiter.pid <> ${readiness.holderPid}
            and ${readiness.holderPid} = any(pg_blocking_pids(waiter.pid))
        ) as blocked`,
      );

      if (rows[0]?.blocked) {
        outcome = "waiting";
        break;
      }

      // This polls live PostgreSQL process state; fake timers cannot advance backend waits.
      await Bun.sleep(20);
    }

    if (completed) outcome = "changed";
  } catch (error) {
    observationResult = { ok: false, error };
  }

  release.resolve();
  const [holderResult, changeResult] = await Promise.all([inFlight, pending]);

  if (!observationResult.ok) throw observationResult.error;

  if (!holderResult.ok) throw holderResult.error;

  if (!changeResult.ok) throw changeResult.error;

  if (outcome === "timeout") {
    throw new Error("the change neither completed nor blocked within 1s");
  }

  return outcome;
}

await resetTestDatabase();

const founder = await createFounderSession();

test("a general lock is inclusive and only an active user exception bypasses it", async () => {
  const fixture = await createAccountingFixture(founder, "general-lock", { timeZone: "UTC" });
  const { cash, exemptIncome } = lockAccountsOf(fixture.accounts);
  const ca = await createTestUser("general-lock-ca");
  await joinOrganization(ca, fixture.organization.id, "ca");
  const caApi = clientFor(ca);
  const claim = { orgSlug: fixture.organization.slug };

  await caApi.lock.set({
    ...claim,
    kind: "general",
    lockedThrough: today,
    expectedLockedThrough: null,
    reason: "Month closed",
  });

  await expectReason(
    postJournal(fixture.api, claim.orgSlug, cash, exemptIncome, today, "Blocked on lock date"),
    "LOCKED",
  );
  await postJournal(
    fixture.api,
    claim.orgSlug,
    cash,
    exemptIncome,
    tomorrow,
    "After locked period",
  );

  const exception = await caApi.lock.grantException({
    ...claim,
    userId: fixture.accountant.user.id,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    reason: "Complete one adjustment",
  });

  await postJournal(
    fixture.api,
    claim.orgSlug,
    cash,
    exemptIncome,
    today,
    "Adjustment under exception",
  );

  const locked = await caApi.lock.get(claim);
  expect(locked.general).toMatchObject({ lockedThrough: today, reason: "Month closed" });
  expect(locked.exceptions).toEqual([
    expect.objectContaining({ id: exception.id, userId: fixture.accountant.user.id }),
  ]);

  await caApi.lock.revokeException({ ...claim, exceptionId: exception.id });
  await expectReason(
    postJournal(fixture.api, claim.orgSlug, cash, exemptIncome, today, "Blocked after revoke"),
    "LOCKED",
  );
  await expectORPCCode(
    caApi.lock.revokeException({ ...claim, exceptionId: exception.id }),
    "CONFLICT",
  );
  await expectReason(
    caApi.lock.grantException({
      ...claim,
      userId: fixture.accountant.user.id,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      reason: "Already expired",
    }),
    "EXPIRY_PAST",
  );
  await expectReason(
    caApi.lock.grantException({
      ...claim,
      userId: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      reason: "Not an organization member",
    }),
    "MEMBER_INVALID",
  );
  await expectORPCCode(
    fixture.api.lock.set({
      ...claim,
      kind: "general",
      lockedThrough: null,
      expectedLockedThrough: today,
      reason: "Not permitted",
    }),
    "FORBIDDEN",
  );

  await caApi.lock.set({
    ...claim,
    kind: "general",
    lockedThrough: null,
    expectedLockedThrough: today,
    reason: "Reopened",
  });
  await postJournal(fixture.api, claim.orgSlug, cash, exemptIncome, today, "Posted after reopen");

  expect((await caApi.lock.get(claim)).general).toMatchObject({
    lockedThrough: null,
    reason: "Reopened",
  });
});

test("a stale lock change cannot reopen a newer close", async () => {
  const fixture = await createAccountingFixture(founder, "stale-lock", { timeZone: "UTC" });
  const ca = await createTestUser("stale-lock-ca");
  await joinOrganization(ca, fixture.organization.id, "ca");
  const caApi = clientFor(ca);
  const claim = { orgSlug: fixture.organization.slug };

  await caApi.lock.set({
    ...claim,
    kind: "general",
    lockedThrough: yesterday,
    expectedLockedThrough: null,
    reason: "Initial close",
  });
  const staleExpected = (await caApi.lock.get(claim)).general?.lockedThrough ?? null;

  await caApi.lock.set({
    ...claim,
    kind: "general",
    lockedThrough: today,
    expectedLockedThrough: staleExpected,
    reason: "Newer close",
  });
  const countsBefore = await lockChangeCounts(fixture.organization.id);
  expect(countsBefore).toEqual({ history: 2, audits: 2 });

  await expectORPCCode(
    caApi.lock.set({
      ...claim,
      kind: "general",
      lockedThrough: null,
      expectedLockedThrough: staleExpected,
      reason: "Stale reopen",
    }),
    "CONFLICT",
  );
  const countsAfter = await lockChangeCounts(fixture.organization.id);

  expect(countsAfter).toEqual(countsBefore);
  expect((await caApi.lock.get(claim)).general?.lockedThrough).toBe(today);

  await caApi.lock.set({
    ...claim,
    kind: "general",
    lockedThrough: null,
    expectedLockedThrough: today,
    reason: "Deliberate reopen",
  });
  expect((await caApi.lock.get(claim)).general?.lockedThrough).toBeNull();
});

test("missing organization settings is an integrity failure, not a stale lock conflict", async () => {
  const fixture = await createAccountingFixture(founder, "missing-lock-settings", {
    timeZone: "UTC",
  });

  const ca = await createTestUser("missing-lock-settings-ca");
  await joinOrganization(ca, fixture.organization.id, "ca");
  const caApi = clientFor(ca);

  await db
    .delete(organizationSettings)
    .where(eq(organizationSettings.orgId, fixture.organization.id));

  await expectORPCCode(
    caApi.lock.set({
      orgSlug: fixture.organization.slug,
      kind: "general",
      lockedThrough: today,
      expectedLockedThrough: null,
      reason: "Cannot close corrupt organization",
    }),
    "INTERNAL_SERVER_ERROR",
  );
  expect(await lockChangeCounts(fixture.organization.id)).toEqual({ history: 0, audits: 0 });
});

test("the tax lock follows affectsTax while cancellations use the reversal date", async () => {
  const fixture = await createAccountingFixture(founder, "tax-lock", {
    gstin: "27ABCDE1234F1Z5",
    stateCode: "27",
    pan: "ABCDE1234F",
    timeZone: "UTC",
  });

  const { cash, exemptIncome } = lockAccountsOf(fixture.accounts);

  const cashMethod = required(
    fixture.methods.find(({ name }) => name === "Cash"),
    "cash payment method",
  );

  const ca = await createTestUser("tax-lock-ca");
  await joinOrganization(ca, fixture.organization.id, "ca");
  const caApi = clientFor(ca);
  const claim = { orgSlug: fixture.organization.slug };

  const oldJournal = await postJournal(
    fixture.api,
    claim.orgSlug,
    cash,
    exemptIncome,
    yesterday,
    "Journal before tax lock",
  );

  const oldReceipt = await fixture.api.receipt.post({
    ...claim,
    settlementKind: "direct",
    amount: "1.00",
    paymentMethodId: cashMethod.id,
    incomeAccountId: exemptIncome.id,
    narration: "Exempt receipt before tax lock",
    documentDate: yesterday,
  });

  await caApi.lock.set({
    ...claim,
    kind: "tax",
    lockedThrough: today,
    expectedLockedThrough: null,
    reason: "GST return filed",
  });

  await expectReason(
    fixture.api.receipt.post({
      ...claim,
      settlementKind: "direct",
      amount: "1.00",
      paymentMethodId: cashMethod.id,
      incomeAccountId: exemptIncome.id,
      narration: "Exempt receipt in filed period",
      documentDate: today,
    }),
    "LOCKED",
  );
  await postJournal(
    fixture.api,
    claim.orgSlug,
    cash,
    exemptIncome,
    today,
    "Journal does not affect tax",
  );
  await expectReason(
    fixture.api.receipt.cancel({
      ...claim,
      receiptId: oldReceipt.id,
      reason: "Reverse while today is tax locked",
    }),
    "LOCKED",
  );

  await caApi.lock.set({
    ...claim,
    kind: "tax",
    lockedThrough: yesterday,
    expectedLockedThrough: today,
    reason: "Reopened current tax date",
  });
  expect(
    await fixture.api.receipt.cancel({
      ...claim,
      receiptId: oldReceipt.id,
      reason: "Reverse on open current date",
    }),
  ).toMatchObject({ state: "cancelled" });
  expect(
    await fixture.api.journal.cancel({
      ...claim,
      journalId: oldJournal.id,
      reason: "Journal is outside the tax lock",
    }),
  ).toMatchObject({ state: "cancelled" });

  await caApi.lock.set({
    ...claim,
    kind: "general",
    lockedThrough: today,
    expectedLockedThrough: null,
    reason: "Books closed",
  });
  await expectReason(
    fixture.api.allocation.apply({
      ...claim,
      sourceDocumentId: crypto.randomUUID(),
      targetDocumentId: crypto.randomUUID(),
      amount: "1.00",
    }),
    "LOCKED",
  );
});

test("a lock change waits for a posting that already passed its check", async () => {
  const fixture = await createAccountingFixture(founder, "lock-race", { timeZone: "UTC" });
  const { cash, exemptIncome } = lockAccountsOf(fixture.accounts);
  const ca = await createTestUser("lock-race-ca");
  await joinOrganization(ca, fixture.organization.id, "ca");
  const caApi = clientFor(ca);
  const claim = { orgSlug: fixture.organization.slug };

  const scope: Scope = {
    orgId: fixture.organization.id,
    userId: fixture.accountant.user.id,
    roles: ["accountant"],
  };

  expect(
    await raceLockChange(scope, () =>
      caApi.lock.set({
        ...claim,
        kind: "general",
        lockedThrough: today,
        expectedLockedThrough: null,
        reason: "Close today",
      }),
    ),
  ).toBe("waiting");
  await expectReason(
    postJournal(fixture.api, claim.orgSlug, cash, exemptIncome, today, "Blocked after race"),
    "LOCKED",
  );

  const exception = await caApi.lock.grantException({
    ...claim,
    userId: fixture.accountant.user.id,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    reason: "One adjustment",
  });

  expect(
    await raceLockChange(scope, () =>
      caApi.lock.revokeException({ ...claim, exceptionId: exception.id }),
    ),
  ).toBe("waiting");
  await expectReason(
    postJournal(fixture.api, claim.orgSlug, cash, exemptIncome, today, "Blocked after revoke"),
    "LOCKED",
  );
});
