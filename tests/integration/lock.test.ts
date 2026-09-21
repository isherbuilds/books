import { expect, test } from "bun:test";

import { assertPeriodOpen } from "@accly/api/core/locks";
import type { Scope } from "@accly/api/lib/procedures/factory";
import { orgSettings } from "@accly/api/lib/settlements";
import type { AppRouterClient } from "@accly/api/routers/index";
import { db } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { sql } from "drizzle-orm";

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

/**
 * Runs `change` while a posting holds its passed period check open in an uncommitted
 * transaction. Resolves "waiting" once Postgres reports the change blocked on a row
 * lock, the only outcome the mutex allows; "changed" means it landed between the
 * check and the commit. No timer: the loop ends on observed state either way.
 */
async function raceLockChange(
  scope: Scope,
  change: () => Promise<unknown>,
): Promise<"changed" | "waiting"> {
  const checked = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();

  const inFlight = db.transaction(async (tx) => {
    const settings = await orgSettings(scope.orgId, tx);
    await assertPeriodOpen(tx, scope, settings, { entryDate: today, affectsTax: false });
    checked.resolve();
    await release.promise;
  });

  await checked.promise;

  let settled = false;
  let blocked = false;

  const pending = change().finally(() => {
    settled = true;
  });

  // A waiter holds a granted tuple lock on the settings table while it waits on the
  // holder's transaction, and pg_blocking_pids names who blocks it.
  try {
    for (let probes = 0; probes < 5000 && !settled && !blocked; probes++) {
      const { rows } = await db.execute<{ blocked: boolean }>(
        sql`select exists(
          select 1 from pg_locks l join pg_class c on c.oid = l.relation
          where c.relname = 'organization_settings' and l.locktype = 'tuple'
            and cardinality(pg_blocking_pids(l.pid)) > 0
        ) as blocked`,
      );

      blocked = rows[0]?.blocked ?? false;
    }
  } finally {
    release.resolve();
    await inFlight;
  }

  await pending;

  if (!settled && !blocked) throw new Error("the change neither settled nor blocked");

  return blocked ? "waiting" : "changed";
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

  await caApi.lock.revokeException({
    ...claim,
    exceptionId: exception.id,
    reason: "Adjustment complete",
  });
  await expectReason(
    postJournal(fixture.api, claim.orgSlug, cash, exemptIncome, today, "Blocked after revoke"),
    "LOCKED",
  );
  await expectORPCCode(
    caApi.lock.revokeException({
      ...claim,
      exceptionId: exception.id,
      reason: "Revoke twice",
    }),
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
      reason: "Not permitted",
    }),
    "FORBIDDEN",
  );

  await caApi.lock.set({
    ...claim,
    kind: "general",
    lockedThrough: null,
    reason: "Reopened",
  });
  await postJournal(fixture.api, claim.orgSlug, cash, exemptIncome, today, "Posted after reopen");

  expect((await caApi.lock.get(claim)).general).toMatchObject({
    lockedThrough: null,
    reason: "Reopened",
  });
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
    reason: "Books closed",
  });
  await expectReason(
    fixture.api.allocation.apply({
      ...claim,
      receiptId: crypto.randomUUID(),
      invoiceId: crypto.randomUUID(),
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
      caApi.lock.set({ ...claim, kind: "general", lockedThrough: today, reason: "Close today" }),
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
      caApi.lock.revokeException({ ...claim, exceptionId: exception.id, reason: "Done" }),
    ),
  ).toBe("waiting");
  await expectReason(
    postJournal(fixture.api, claim.orgSlug, cash, exemptIncome, today, "Blocked after revoke"),
    "LOCKED",
  );
});
