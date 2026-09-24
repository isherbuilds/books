import { beforeAll, expect, test } from "bun:test";

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

  await accountantApi.item.setActive({ orgSlug, itemId: item.id, active: false });
  await accountantApi.account.setActive({ orgSlug, accountId: income.id, active: false });
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
