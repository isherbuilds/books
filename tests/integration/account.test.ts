import { beforeAll, expect, test } from "bun:test";

import type { AppRouterClient } from "@accly/api/routers/index";

import { createAccountingFixture } from "../support/accounting";
import { createFounderSession, type TestUser } from "../support/auth";
import { expectORPCCode } from "../support/client";
import { resetTestDatabase } from "../support/database";

let founder: TestUser;

let organization: { id: string; slug: string };

let accountantApi: AppRouterClient;

beforeAll(async () => {
  await resetTestDatabase();
  founder = await createFounderSession();
  const fixture = await createAccountingFixture(founder, "account");
  organization = fixture.organization;
  accountantApi = fixture.api;
});

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

  await accountantApi.account.update({
    orgSlug,
    accountId: tuition.id,
    name: "Tuition Revenue",
    updatedAt: tuition.updatedAt.toISOString(),
  });

  const renamed = await accountantApi.account.list({ orgSlug, type: "income" });
  expect(renamed.find(({ id }) => id === tuition.id)?.name).toBe("Tuition Revenue");

  await accountantApi.account.setActive({ orgSlug, accountId: discount.id, active: false });

  const afterArchive = await accountantApi.journal.accounts({ orgSlug });
  expect(afterArchive.some(({ id }) => id === discount.id)).toBe(false);
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

  await expectORPCCode(
    accountantApi.account.setActive({ orgSlug, accountId: income.id, active: false }),
    "BAD_REQUEST",
  );

  await accountantApi.item.setActive({ orgSlug, itemId: item.id, active: false });
  await accountantApi.account.setActive({ orgSlug, accountId: income.id, active: false });
});
