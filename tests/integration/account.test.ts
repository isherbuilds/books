import { beforeAll, expect, test } from "bun:test";

import { businessDate } from "@accly/api/lib/business-date";
import type { AppRouterClient } from "@accly/api/routers/index";
import { db } from "@accly/db";
import { journalLines } from "@accly/db/schema/journal-lines";
import { and, eq, sql } from "drizzle-orm";

import { createAccountingFixture } from "../support/accounting";
import { required } from "../support/assert";
import {
  createFounderSession,
  createTestUser,
  joinOrganization,
  type TestUser,
} from "../support/auth";
import { clientFor, expectORPCCode, expectReason } from "../support/client";
import { resetTestDatabase } from "../support/database";

let founder: TestUser;

let organization: { id: string; slug: string };

let accountantApi: AppRouterClient;

let fixture: Awaited<ReturnType<typeof createAccountingFixture>>;

beforeAll(async () => {
  await resetTestDatabase();
  founder = await createFounderSession();
  fixture = await createAccountingFixture(founder, "account");
  organization = fixture.organization;
  accountantApi = fixture.api;
});

// No report reads an expense leaf yet, so its balance is summed from journal lines.
async function balanceOf(accountId: string): Promise<bigint> {
  const [row] = await db
    .select({
      balance: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)::bigint`,
    })
    .from(journalLines)
    .where(and(eq(journalLines.orgId, organization.id), eq(journalLines.accountId, accountId)));

  return BigInt(required(row, "balance").balance);
}

test("accountants create, rename and archive leaves", async () => {
  const orgSlug = organization.slug;

  const tuition = await accountantApi.account.create({
    orgSlug,
    parent: { type: "income" },
    name: "Tuition Fees",
    supplyClass: "exempt",
  });

  const discount = await accountantApi.account.create({
    orgSlug,
    parent: { type: "expense" },
    name: "Sibling Discount",
  });

  const income = await accountantApi.account.list({ orgSlug, type: "income", activeOnly: true });
  expect(income.some(({ id }) => id === tuition.id)).toBe(true);

  const journalAccounts = await accountantApi.journal.accounts({ orgSlug });
  expect(journalAccounts.some(({ id }) => id === discount.id)).toBe(true);

  const rename = {
    orgSlug,
    accountId: tuition.id,
    name: "Tuition Revenue",
    updatedAt: tuition.updatedAt.toISOString(),
  };

  await accountantApi.account.update(rename);

  const renamed = await accountantApi.account.list({ orgSlug, type: "income" });
  expect(renamed.find(({ id }) => id === tuition.id)?.name).toBe("Tuition Revenue");
  // The token moved with the rename, so an editor still holding the old one is refused.

  const stale = await expectORPCCode(
    accountantApi.account.update({ ...rename, name: "Tuition" }),
    "CONFLICT",
  );

  expect(stale.data).toMatchObject({ reason: "STALE_RECORD" });

  await accountantApi.journal.post({
    orgSlug,
    documentDate: "2026-04-01",
    narration: "Sibling discount",
    lines: [
      { accountId: discount.id, side: "debit", amount: "500.00" },
      { accountId: tuition.id, side: "credit", amount: "500.00" },
    ],
  });

  await accountantApi.account.setActive({ orgSlug, accountId: discount.id, active: false });

  const afterArchive = await accountantApi.journal.accounts({ orgSlug });
  expect(afterArchive.some(({ id }) => id === discount.id)).toBe(false);
  expect(await balanceOf(discount.id)).toBe(50_000n);

  const operator = await createTestUser("account-operator");
  await joinOrganization(operator, organization.id, "operator");
  await expectORPCCode(
    clientFor(operator).account.create({ orgSlug, parent: { type: "expense" }, name: "Nope" }),
    "FORBIDDEN",
  );
});

test("account creation and restoration refuse foreign parents and taken names", async () => {
  const orgSlug = organization.slug;

  const foreign = await createAccountingFixture(founder, "account-foreign");

  const foreignParent = foreign.accounts.find(
    ({ code, systemKey }) => code === "100" && systemKey === null,
  );

  await expectORPCCode(
    accountantApi.account.create({
      orgSlug,
      parent: { accountId: foreignParent!.id },
      name: "Foreign Parent",
    }),
    "NOT_FOUND",
  );

  const repairs = await accountantApi.account.create({
    orgSlug,
    parent: { type: "expense" },
    name: "Bus Repairs",
  });

  // Templates own 6800–6999; user expense codes must never run into Round Off (6900).
  expect(Number(repairs.code)).toBeLessThan(6800);

  const duplicate = await expectORPCCode(
    accountantApi.account.create({ orgSlug, parent: { type: "expense" }, name: "bus repairs" }),
    "CONFLICT",
  );

  expect(duplicate.data).toMatchObject({ reason: "ACCOUNT_NAME_TAKEN" });

  await accountantApi.account.setActive({ orgSlug, accountId: repairs.id, active: false });
  await accountantApi.account.create({ orgSlug, parent: { type: "expense" }, name: "Bus Repairs" });

  const restore = await expectORPCCode(
    accountantApi.account.setActive({ orgSlug, accountId: repairs.id, active: true }),
    "CONFLICT",
  );

  expect(restore.data).toMatchObject({ reason: "ACCOUNT_NAME_TAKEN" });
});

test("an income account cannot be archived while an active item uses it", async () => {
  const orgSlug = organization.slug;

  const income = await accountantApi.account.create({
    orgSlug,
    parent: { type: "income" },
    name: "Course Fees",
    supplyClass: "exempt",
  });

  const item = await accountantApi.item.create({
    orgSlug,
    name: "Course",
    unitPrice: "100.00",
    incomeAccountId: income.id,
  });

  await expectReason(
    accountantApi.account.setActive({ orgSlug, accountId: income.id, active: false }),
    "ACCOUNT_IN_USE",
  );

  const inactive = await accountantApi.item.setActive({
    orgSlug,
    itemId: item.id,
    updatedAt: item.updatedAt.toISOString(),
    active: false,
  });

  await accountantApi.account.setActive({ orgSlug, accountId: income.id, active: false });

  // Restoring an Item does not check its account.
  await accountantApi.item.setActive({
    orgSlug,
    itemId: item.id,
    updatedAt: inactive.updatedAt.toISOString(),
    active: true,
  });
});

test("the chart protects system accounts, posting leaves and money leaves in use", async () => {
  const orgSlug = organization.slug;

  const receivables = required(
    fixture.accounts.find(({ systemKey }) => systemKey === "receivables"),
    "receivables account",
  );

  const method = required(fixture.methods[0], "payment method");

  await expectReason(
    accountantApi.account.setActive({ orgSlug, accountId: receivables.id, active: false }),
    "ACCOUNT_SYSTEM",
  );
  await expectReason(
    accountantApi.account.setActive({ orgSlug, accountId: method.accountId, active: false }),
    "ACCOUNT_IN_USE",
  );

  const leaf = await accountantApi.account.create({
    orgSlug,
    parent: { type: "expense" },
    name: "Stationery",
  });

  await expectReason(
    accountantApi.account.create({ orgSlug, parent: { accountId: leaf.id }, name: "Pens" }),
    "ACCOUNT_PARENT_INVALID",
  );
});

test("Home and Banking balances exclude future receipts and reconcile with dated reports", async () => {
  const timeZone = "Asia/Kolkata";

  const {
    api,
    organization: org,
    methods,
  } = await createAccountingFixture(founder, "account-as-of-today", { timeZone });

  const claim = { orgSlug: org.slug };
  const today = businessDate(new Date(), timeZone);
  const midnight = new Date(`${today}T00:00:00Z`).getTime();
  const yesterday = new Date(midnight - 86_400_000).toISOString().slice(0, 10);
  const tomorrow = new Date(midnight + 86_400_000).toISOString().slice(0, 10);

  const method = required(
    methods.find(({ name }) => name === "Bank transfer"),
    "bank method",
  );

  const party = await api.party.create({
    ...claim,
    name: "Advance customer",
    roles: ["customer"],
    stateCode: "27",
  });

  const receipt = {
    ...claim,
    settlementKind: "advance" as const,
    advanceSupply: "exempt" as const,
    partyId: party.id,
    paymentMethodId: method.id,
  };

  await api.receipt.post({ ...receipt, amount: "500.00", documentDate: tomorrow });
  expect(
    (await api.account.moneyBalances(claim)).find(({ id }) => id === method.accountId),
  ).toMatchObject({ balancePaise: 0n });
  expect(await api.party.balances(claim)).toEqual([]);

  await api.receipt.post({ ...receipt, amount: "100.00", documentDate: yesterday });
  await api.receipt.post({ ...receipt, amount: "200.00", documentDate: today });

  const [money, parties, sheet, ledger, statement, futureSheet, futureStatement] =
    await Promise.all([
      api.account.moneyBalances(claim),
      api.party.balances(claim),
      api.report.balanceSheet({ ...claim, asOf: today }),
      api.report.accountLedger({
        ...claim,
        accountId: method.accountId,
        from: yesterday,
        to: today,
      }),
      api.party.statement({ ...claim, partyId: party.id, to: today }),
      api.report.balanceSheet({ ...claim, asOf: tomorrow }),
      api.party.statement({ ...claim, partyId: party.id, to: tomorrow }),
    ]);

  const bank = required(
    money.find(({ id }) => id === method.accountId),
    "bank balance",
  );

  expect(bank.balancePaise).toBe(30_000n);
  // This isolated organization has no assets other than the receipts' bank balance.
  expect(sheet.assetsPaise).toBe(bank.balancePaise);
  expect(ledger.closingPaise).toBe(bank.balancePaise);
  expect(ledger.lines.map(({ entryDate }) => entryDate)).toEqual([yesterday, today]);
  expect(parties).toEqual([{ partyId: party.id, balancePaise: statement.closingPaise }]);
  expect(statement.closingPaise).toBe(-30_000n);
  // Future dates stay valid, and explicit report dates still include them.
  expect(futureSheet.assetsPaise).toBe(80_000n);
  expect(futureStatement.closingPaise).toBe(-80_000n);
});
