import { expect, test } from "bun:test";

import { accounts } from "@accly/db/schema/accounts";

import { createAccountingFixture, postingOf } from "../support/accounting";
import { required } from "../support/assert";
import { createFounderSession, createTestUser, joinOrganization } from "../support/auth";
import { clientFor, expectORPCCode, expectReason } from "../support/client";
import { resetTestDatabase } from "../support/database";

type Account = typeof accounts.$inferSelect;

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

test("an opening balance posts once, moves balances, cancels, and can be replaced", async () => {
  const fixture = await createAccountingFixture(founder, "opening-balance-workflow");
  const { cash, bank, openingEquity } = openingBalanceAccountsOf(fixture.accounts);
  const claim = { orgSlug: fixture.organization.slug };

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
    documentDate: "2026-04-01",
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

  const cancelled = await fixture.api.openingBalance.cancel({
    ...claim,
    openingBalanceId: posted.id,
    reason: "Wrong cutover figures",
  });

  expect(cancelled.state).toBe("cancelled");
  expect(await fixture.api.openingBalance.get(claim)).toBeNull();

  const replacement = await fixture.api.openingBalance.post({
    ...claim,
    documentDate: "2026-04-01",
    lines,
  });

  expect(replacement.number).toMatch(/^OB\d{2}-\d{2}\/2$/);
});

test("opening balance refuses a second posted document, control accounts, and CA posting", async () => {
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

  const posted = await fixture.api.openingBalance.post(validInput);
  await expectORPCCode(fixture.api.openingBalance.post(validInput), "CONFLICT");

  await fixture.api.openingBalance.cancel({
    ...claim,
    openingBalanceId: posted.id,
    reason: "Test the replacement validation",
  });

  await expectReason(
    fixture.api.openingBalance.post({
      ...claim,
      documentDate: "2026-04-01",
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
