import { expect, test } from "bun:test";

import { db } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { journalEntries } from "@accly/db/schema/journal-entries";
import { journalLines } from "@accly/db/schema/journal-lines";
import { and, eq, lte, sql } from "drizzle-orm";

import { createAccountingFixture, postingOf } from "../support/accounting";
import { required } from "../support/assert";
import { createFounderSession, createTestUser, joinOrganization } from "../support/auth";
import { clientFor, expectORPCCode, expectReason } from "../support/client";
import { resetTestDatabase } from "../support/database";

type Account = typeof accounts.$inferSelect;

async function balanceOn(orgId: string, accountId: string, through: string) {
  const [row] = await db
    .select({
      balancePaise:
        sql<bigint>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)::bigint`.mapWith(
          BigInt,
        ),
    })
    .from(journalLines)
    .innerJoin(
      journalEntries,
      and(eq(journalEntries.orgId, orgId), eq(journalEntries.id, journalLines.entryId)),
    )
    .where(
      and(
        eq(journalLines.orgId, orgId),
        eq(journalLines.accountId, accountId),
        lte(journalEntries.entryDate, through),
      ),
    );

  return required(row, `balance for account ${accountId} through ${through}`).balancePaise;
}

function openingBalanceAccountsOf(rows: Account[]) {
  const cashGroup = required(
    rows.find(({ systemKey }) => systemKey === "cash"),
    "cash group",
  );

  const bankGroup = required(
    rows.find(({ systemKey }) => systemKey === "bank"),
    "bank group",
  );

  return {
    cash: required(
      rows.find(({ parentId, active }) => parentId === cashGroup.id && active),
      "cash account",
    ),
    bank: required(
      rows.find(({ parentId, active }) => parentId === bankGroup.id && active),
      "bank account",
    ),
    openingEquity: required(
      rows.find(({ systemKey }) => systemKey === "openingEquity"),
      "opening equity account",
    ),
    receivables: required(
      rows.find(({ systemKey }) => systemKey === "receivables"),
      "receivables account",
    ),
  };
}

await resetTestDatabase();

const founder = await createFounderSession();

test("opening correction enforces the cutover lock and corrects historical balances", async () => {
  const fixture = await createAccountingFixture(founder, "opening-balance-workflow");
  const { cash, bank, openingEquity } = openingBalanceAccountsOf(fixture.accounts);
  const claim = { orgSlug: fixture.organization.slug };
  const originalDate = "2026-04-01";

  const lines = [
    { accountId: cash.id, side: "debit" as const, amount: "60.00", description: "Cash on hand" },
    { accountId: bank.id, side: "debit" as const, amount: "40.00", description: "Bank balance" },
    {
      accountId: openingEquity.id,
      side: "credit" as const,
      amount: "100.00",
      description: "Opening equity",
    },
  ];

  expect(await fixture.api.openingBalance.get(claim)).toBeNull();

  const balancesBefore = await fixture.api.account.moneyBalances(claim);
  const historicalCashBefore = await balanceOn(fixture.organization.id, cash.id, originalDate);

  const cashBefore = required(
    balancesBefore.find(({ id }) => id === cash.id),
    "cash balance before opening balance",
  ).balancePaise;

  const bankBefore = required(
    balancesBefore.find(({ id }) => id === bank.id),
    "bank balance before opening balance",
  ).balancePaise;

  const posted = await fixture.api.openingBalance.post({
    ...claim,
    documentDate: originalDate,
    lines,
  });

  expect(posted.number).toMatch(/^OB\d{2}-\d{2}\/1$/);

  const [detail, posting, balancesAfter] = await Promise.all([
    fixture.api.openingBalance.get(claim),
    postingOf(fixture.organization.id, posted.id, "post"),
    fixture.api.account.moneyBalances(claim),
  ]);

  expect(detail).toMatchObject({ id: posted.id, number: posted.number, totalPaise: 10_000n });
  expect(detail?.lines).toEqual([
    expect.objectContaining({
      accountId: cash.id,
      accountName: cash.name,
      side: "debit",
      amountPaise: 6_000n,
    }),
    expect.objectContaining({
      accountId: bank.id,
      accountName: bank.name,
      side: "debit",
      amountPaise: 4_000n,
    }),
    expect.objectContaining({
      accountId: openingEquity.id,
      accountName: openingEquity.name,
      side: "credit",
      amountPaise: 10_000n,
    }),
  ]);
  expect(posting.lines.reduce((sum, line) => sum + line.debit, 0n)).toBe(10_000n);
  expect(posting.lines.reduce((sum, line) => sum + line.credit, 0n)).toBe(10_000n);
  expect(
    required(
      balancesAfter.find(({ id }) => id === cash.id),
      "cash balance after opening balance",
    ).balancePaise,
  ).toBe(cashBefore + 6_000n);
  expect(
    required(
      balancesAfter.find(({ id }) => id === bank.id),
      "bank balance after opening balance",
    ).balancePaise,
  ).toBe(bankBefore + 4_000n);

  const ownerApi = clientFor(founder);
  await ownerApi.lock.set({
    ...claim,
    kind: "general",
    lockedThrough: originalDate,
    expectedLockedThrough: null,
    reason: "Cutover signed off",
  });
  await expectReason(
    fixture.api.openingBalance.cancel({
      ...claim,
      openingBalanceId: posted.id,
      reason: "Correct locked opening figures",
    }),
    "LOCKED",
  );
  expect(await fixture.api.openingBalance.get(claim)).toMatchObject({ id: posted.id });
  expect(await balanceOn(fixture.organization.id, cash.id, originalDate)).toBe(
    historicalCashBefore + 6_000n,
  );
  await ownerApi.lock.grantException({
    ...claim,
    userId: fixture.accountant.user.id,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    reason: "Approve historical opening correction",
  });

  const cancelled = await fixture.api.openingBalance.cancel({
    ...claim,
    openingBalanceId: posted.id,
    reason: "Wrong cutover figures",
  });

  expect(cancelled.state).toBe("cancelled");
  expect(await fixture.api.openingBalance.get(claim)).toBeNull();

  const reversal = await postingOf(fixture.organization.id, posted.id, "reverse");
  expect(reversal.entry.reversesEntryId).toBe(posting.entry.id);
  expect(reversal.entry.entryDate).toBe(originalDate);
  expect(await balanceOn(fixture.organization.id, cash.id, originalDate)).toBe(
    historicalCashBefore,
  );

  const replacement = await fixture.api.openingBalance.post({
    ...claim,
    documentDate: originalDate,
    lines: [
      { accountId: cash.id, side: "debit", amount: "80.00" },
      { accountId: bank.id, side: "debit", amount: "40.00" },
      { accountId: openingEquity.id, side: "credit", amount: "120.00" },
    ],
  });

  expect(replacement.number).toMatch(/^OB\d{2}-\d{2}\/2$/);

  const balancesAfterReplacement = await fixture.api.account.moneyBalances(claim);
  expect(
    required(
      balancesAfterReplacement.find(({ id }) => id === cash.id),
      "cash balance after replacement opening balance",
    ).balancePaise,
  ).toBe(cashBefore + 8_000n);
  expect(
    required(
      balancesAfterReplacement.find(({ id }) => id === bank.id),
      "bank balance after replacement opening balance",
    ).balancePaise,
  ).toBe(bankBefore + 4_000n);
  expect(await balanceOn(fixture.organization.id, cash.id, originalDate)).toBe(
    historicalCashBefore + 8_000n,
  );

  const isolated = await createAccountingFixture(founder, "opening-balance-isolation");
  const isolatedAccounts = openingBalanceAccountsOf(isolated.accounts);

  const isolatedOpening = await isolated.api.openingBalance.post({
    orgSlug: isolated.organization.slug,
    documentDate: originalDate,
    lines: [
      { accountId: isolatedAccounts.cash.id, side: "debit", amount: "1.00" },
      { accountId: isolatedAccounts.openingEquity.id, side: "credit", amount: "1.00" },
    ],
  });

  expect(isolatedOpening.number).toMatch(/^OB\d{2}-\d{2}\/1$/);
});

test("opening balance refuses a future date, a second posted document, control accounts, and CA posting", async () => {
  const fixture = await createAccountingFixture(founder, "opening-balance-refusals");
  const { cash, openingEquity, receivables } = openingBalanceAccountsOf(fixture.accounts);
  const claim = { orgSlug: fixture.organization.slug };

  const validInput = {
    ...claim,
    documentDate: "2026-04-01",
    lines: [
      { accountId: cash.id, side: "debit" as const, amount: "1.00" },
      { accountId: openingEquity.id, side: "credit" as const, amount: "1.00" },
    ],
  };

  await expectReason(
    fixture.api.openingBalance.post({ ...validInput, documentDate: "2999-01-01" }),
    "OPENING_BALANCE_DATE_FUTURE",
  );

  const posted = await fixture.api.openingBalance.post(validInput);
  await expectORPCCode(fixture.api.openingBalance.post(validInput), "CONFLICT");

  await fixture.api.openingBalance.cancel({
    ...claim,
    openingBalanceId: posted.id,
    reason: "Test the replacement validation",
  });
  const reversal = await postingOf(fixture.organization.id, posted.id, "reverse");

  await expectReason(
    fixture.api.openingBalance.post({
      ...claim,
      documentDate: reversal.entry.entryDate,
      lines: [
        { accountId: receivables.id, side: "debit", amount: "1.00" },
        { accountId: openingEquity.id, side: "credit", amount: "1.00" },
      ],
    }),
    "ACCOUNT_INVALID",
  );

  const ca = await createTestUser("opening-balance-ca");
  await joinOrganization(ca, fixture.organization.id, "ca");
  await expectORPCCode(clientFor(ca).openingBalance.post(validInput), "FORBIDDEN");
});
