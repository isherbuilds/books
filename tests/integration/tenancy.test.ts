import { beforeAll, expect, test } from "bun:test";

import { drainAuditWrites } from "@accly/api/audit";
import { appRouter, type AppRouterClient } from "@accly/api/routers/index";
import { auth } from "@accly/auth";

import { required } from "../support/assert";
import {
  createOrganization,
  createTestUser,
  joinOrganization,
  removeFromOrganization,
  setMemberRoles,
} from "../support/auth";
import {
  clientFor,
  eventually,
  expectAuthStatus,
  expectORPCCode,
  expectReason,
} from "../support/client";
import { resetTestDatabase } from "../support/database";
import { uniqueSuffix } from "../support/unique";

beforeAll(async () => {
  await resetTestDatabase();
});

test("settings are scoped by explicit input: defaults until saved, then the saved row", async () => {
  const owner = await createTestUser("settings-pages");
  const organization = await createOrganization(owner, "settings-pages");
  const api = clientFor(owner);

  const fresh = await api.settings.get({ orgSlug: organization.slug });
  expect(fresh.receiptPrefix).toBe("RCT");
  expect(fresh.legalName).toBe("settings-pages");

  const saved = await api.settings.update({
    orgSlug: organization.slug,
    ...fresh,
    legalName: "Settings Pages Business Pvt. Ltd.",
    invoicePrefix: "SPH",
  });

  expect(saved.legalName).toBe("Settings Pages Business Pvt. Ltd.");
  expect(await api.settings.get({ orgSlug: organization.slug })).toEqual(saved);

  const entry = await eventually(async () => {
    const audit = await api.audit.list({ orgSlug: organization.slug });

    return audit.items.find((item) => item.action === "settings.update");
  });

  expect(entry.actorId).toBe(owner.user.id);
  expect(entry.orgId).toBe(organization.id);
});

test("settings are invisible across orgs, and a foreign org is FORBIDDEN", async () => {
  const alice = await createTestUser("alice");
  const alpha = await createOrganization(alice, "alpha");
  const aliceClient = clientFor(alice);
  const alphaDefaults = await aliceClient.settings.get({ orgSlug: alpha.slug });
  await aliceClient.settings.update({
    orgSlug: alpha.slug,
    ...alphaDefaults,
    legalName: "alpha secret",
  });

  const bob = await createTestUser("bob");
  const beta = await createOrganization(bob, "beta");
  const bobClient = clientFor(bob);

  const visible = await bobClient.settings.get({ orgSlug: beta.slug });
  expect(visible.legalName).toBe("beta");

  await bobClient.settings.update({ orgSlug: beta.slug, ...visible, legalName: "beta public" });
  const alphaAfter = await aliceClient.settings.get({ orgSlug: alpha.slug });
  expect(alphaAfter.legalName).toBe("alpha secret");

  await expectORPCCode(bobClient.settings.get({ orgSlug: alpha.slug }), "FORBIDDEN");
});

test("a foreign org claim cannot write into that tenant's audit trail", async () => {
  const owner = await createTestUser("owner");
  const organization = await createOrganization(owner, "foreign-claim-audit");
  const visitor = await createTestUser("visitor");

  await expectORPCCode(
    clientFor(visitor).settings.get({ orgSlug: organization.slug }),
    "FORBIDDEN",
  );
  // Draining beats sleeping: a negative assertion behind a fixed interval passes
  // wrongly the moment a reintroduced write lands just after it.
  await drainAuditWrites();

  const audit = await clientFor(owner).audit.list({ orgSlug: organization.slug });
  expect(audit.items.some((entry) => entry.actorId === visitor.user.id)).toBe(false);
});

test("one client can update settings and post receipts and payments in different orgs concurrently", async () => {
  const user = await createTestUser("multi");
  const one = await createOrganization(user, "tab-one");
  const two = await createOrganization(user, "tab-two");
  const api = clientFor(user);

  const [inOne, inTwo] = await Promise.all([
    api.settings
      .get({ orgSlug: one.slug })
      .then((s) => api.settings.update({ orgSlug: one.slug, ...s, legalName: "from tab one" })),
    api.settings
      .get({ orgSlug: two.slug })
      .then((s) => api.settings.update({ orgSlug: two.slug, ...s, legalName: "from tab two" })),
  ]);

  expect(inOne.legalName).toBe("from tab one");
  expect(inTwo.legalName).toBe("from tab two");

  const seenInOne = await api.settings.get({ orgSlug: one.slug });
  expect(seenInOne.legalName).toBe("from tab one");

  const [oneMethods, twoMethods, oneAccounts, twoAccounts] = await Promise.all([
    api.paymentMethod.list({ orgSlug: one.slug }),
    api.paymentMethod.list({ orgSlug: two.slug }),
    api.account.list({ orgSlug: one.slug }),
    api.account.list({ orgSlug: two.slug }),
  ]);

  const oneMethod = oneMethods.find(({ name }) => name === "Cash");
  const twoMethod = twoMethods.find(({ name }) => name === "Cash");

  const oneIncome = oneAccounts.find(
    ({ type, supplyClass }) => type === "income" && supplyClass === "exempt",
  );

  const twoIncome = twoAccounts.find(
    ({ type, supplyClass }) => type === "income" && supplyClass === "exempt",
  );

  const oneExpense = oneAccounts.find(
    ({ type, systemKey }) => type === "expense" && systemKey === null,
  );

  const twoExpense = twoAccounts.find(
    ({ type, systemKey }) => type === "expense" && systemKey === null,
  );

  if (!oneMethod || !twoMethod || !oneIncome || !twoIncome || !oneExpense || !twoExpense) {
    throw new Error("Accounting organization fixtures are incomplete");
  }

  const [receiptOne, receiptTwo] = await Promise.all([
    api.receipt.post({
      orgSlug: one.slug,
      settlementKind: "direct",
      amount: "11.00",
      paymentMethodId: oneMethod.id,
      incomeAccountId: oneIncome.id,
    }),
    api.receipt.post({
      orgSlug: two.slug,
      settlementKind: "direct",
      amount: "22.00",
      paymentMethodId: twoMethod.id,
      incomeAccountId: twoIncome.id,
    }),
  ]);

  const [receiptsOne, receiptsTwo] = await Promise.all([
    api.receipt.list({ orgSlug: one.slug }),
    api.receipt.list({ orgSlug: two.slug }),
  ]);

  expect(receiptsOne.rows.map(({ id }) => id)).toEqual([receiptOne.id]);
  expect(receiptsTwo.rows.map(({ id }) => id)).toEqual([receiptTwo.id]);

  const [paymentOne, paymentTwo] = await Promise.all([
    api.payment.post({
      orgSlug: one.slug,
      settlementKind: "direct",
      amount: "33.00",
      paymentMethodId: oneMethod.id,
      expenseAccountId: oneExpense.id,
    }),
    api.payment.post({
      orgSlug: two.slug,
      settlementKind: "direct",
      amount: "44.00",
      paymentMethodId: twoMethod.id,
      expenseAccountId: twoExpense.id,
    }),
  ]);

  const [paymentsOne, paymentsTwo] = await Promise.all([
    api.payment.list({ orgSlug: one.slug }),
    api.payment.list({ orgSlug: two.slug }),
  ]);

  expect(paymentsOne.rows.map(({ id }) => id)).toEqual([paymentOne.id]);
  expect(paymentsTwo.rows.map(({ id }) => id)).toEqual([paymentTwo.id]);
});

test("one client keeps Items, Invoices, Receipts, Journals, and Allocations isolated across two orgs", async () => {
  const user = await createTestUser("domain-isolation");
  const alpha = await createOrganization(user, "domain-alpha");
  const beta = await createOrganization(user, "domain-beta");
  const api = clientFor(user);

  const [alphaAccounts, betaAccounts, alphaMethods, betaMethods] = await Promise.all([
    api.account.list({ orgSlug: alpha.slug }),
    api.account.list({ orgSlug: beta.slug }),
    api.paymentMethod.list({ orgSlug: alpha.slug }),
    api.paymentMethod.list({ orgSlug: beta.slug }),
  ]);

  const alphaIncome = required(
    alphaAccounts.find(({ type, supplyClass }) => type === "income" && supplyClass === "exempt"),
    "alpha exempt income account",
  );

  const betaIncome = required(
    betaAccounts.find(({ type, supplyClass }) => type === "income" && supplyClass === "exempt"),
    "beta exempt income account",
  );

  const alphaCashGroup = required(
    alphaAccounts.find(({ systemKey }) => systemKey === "cash"),
    "alpha cash group",
  );

  const betaCashGroup = required(
    betaAccounts.find(({ systemKey }) => systemKey === "cash"),
    "beta cash group",
  );

  const alphaCash = required(
    alphaAccounts.find(
      ({ active, parentId, type }) => active && type === "asset" && parentId === alphaCashGroup.id,
    ),
    "alpha cash account",
  );

  const betaCash = required(
    betaAccounts.find(
      ({ active, parentId, type }) => active && type === "asset" && parentId === betaCashGroup.id,
    ),
    "beta cash account",
  );

  const alphaMethod = required(
    alphaMethods.find(({ name }) => name === "Cash"),
    "alpha cash method",
  );

  const betaMethod = required(
    betaMethods.find(({ name }) => name === "Cash"),
    "beta cash method",
  );

  const [alphaParty, betaParty] = await Promise.all([
    api.party.create({
      orgSlug: alpha.slug,
      name: "Shared Customer",
      roles: ["customer"],
      stateCode: "27",
    }),
    api.party.create({
      orgSlug: beta.slug,
      name: "Shared Customer",
      roles: ["customer"],
      stateCode: "27",
    }),
  ]);

  const [alphaJournal, betaJournal] = await Promise.all([
    api.journal.post({
      orgSlug: alpha.slug,
      documentDate: "2026-04-01",
      narration: "Alpha journal",
      lines: [
        { accountId: alphaCash.id, side: "debit", amount: "5.00" },
        { accountId: alphaIncome.id, side: "credit", amount: "5.00" },
      ],
    }),
    api.journal.post({
      orgSlug: beta.slug,
      documentDate: "2026-04-01",
      narration: "Beta journal",
      lines: [
        { accountId: betaCash.id, side: "debit", amount: "5.00" },
        { accountId: betaIncome.id, side: "credit", amount: "5.00" },
      ],
    }),
  ]);

  const [alphaItem, betaItem] = await Promise.all([
    api.item.create({
      orgSlug: alpha.slug,
      name: "Shared Service",
      unitPrice: "5.00",
      incomeAccountId: alphaIncome.id,
    }),
    api.item.create({
      orgSlug: beta.slug,
      name: "Shared Service",
      unitPrice: "5.00",
      incomeAccountId: betaIncome.id,
    }),
  ]);

  const [alphaInvoice, betaInvoice] = await Promise.all([
    api.invoice.post({
      orgSlug: alpha.slug,
      partyId: alphaParty.id,
      placeOfSupplyStateCode: "27",
      lines: [{ kind: "item", itemId: alphaItem.id, quantity: 1 }],
    }),
    api.invoice.post({
      orgSlug: beta.slug,
      partyId: betaParty.id,
      placeOfSupplyStateCode: "27",
      lines: [{ kind: "item", itemId: betaItem.id, quantity: 1 }],
    }),
  ]);

  const [alphaReceipt, betaReceipt] = await Promise.all([
    api.receipt.post({
      orgSlug: alpha.slug,
      settlementKind: "advance",
      partyId: alphaParty.id,
      advanceSupply: "goods",
      amount: "5.00",
      paymentMethodId: alphaMethod.id,
    }),
    api.receipt.post({
      orgSlug: beta.slug,
      settlementKind: "advance",
      partyId: betaParty.id,
      advanceSupply: "goods",
      amount: "5.00",
      paymentMethodId: betaMethod.id,
    }),
  ]);

  const [alphaAllocations] = await Promise.all([
    api.allocation.apply({
      orgSlug: alpha.slug,
      sourceDocumentId: alphaReceipt.id,
      targetDocumentId: alphaInvoice.id,
      amount: "1.00",
    }),
    api.allocation.apply({
      orgSlug: beta.slug,
      sourceDocumentId: betaReceipt.id,
      targetDocumentId: betaInvoice.id,
      amount: "1.00",
    }),
  ]);

  const [
    alphaItems,
    betaItems,
    alphaInvoices,
    betaInvoices,
    alphaJournals,
    betaJournals,
    alphaUnapplied,
    betaUnapplied,
    alphaOpenItems,
    betaOpenItems,
  ] = await Promise.all([
    api.item.list({ orgSlug: alpha.slug }),
    api.item.list({ orgSlug: beta.slug }),
    api.invoice.list({ orgSlug: alpha.slug }),
    api.invoice.list({ orgSlug: beta.slug }),
    api.journal.list({ orgSlug: alpha.slug }),
    api.journal.list({ orgSlug: beta.slug }),
    api.party.openCredits({ orgSlug: alpha.slug, partyId: alphaParty.id, side: "receivable" }),
    api.party.openCredits({ orgSlug: beta.slug, partyId: betaParty.id, side: "receivable" }),
    api.party.openItems({ orgSlug: alpha.slug, partyId: alphaParty.id, side: "receivable" }),
    api.party.openItems({ orgSlug: beta.slug, partyId: betaParty.id, side: "receivable" }),
  ]);

  expect(alphaItems.map(({ id }) => id)).toEqual([alphaItem.id]);
  expect(betaItems.map(({ id }) => id)).toEqual([betaItem.id]);
  expect(alphaInvoices.rows.map(({ id }) => id)).toEqual([alphaInvoice.id]);
  expect(betaInvoices.rows.map(({ id }) => id)).toEqual([betaInvoice.id]);
  expect(alphaJournals.rows.map(({ id }) => id)).toEqual([alphaJournal.id]);
  expect(betaJournals.rows.map(({ id }) => id)).toEqual([betaJournal.id]);
  expect(alphaUnapplied.rows.map(({ id }) => id)).toEqual([alphaReceipt.id]);
  expect(betaUnapplied.rows.map(({ id }) => id)).toEqual([betaReceipt.id]);
  expect(alphaOpenItems.rows.map(({ id }) => id)).toEqual([alphaInvoice.id]);
  expect(betaOpenItems.rows.map(({ id }) => id)).toEqual([betaInvoice.id]);

  await expectORPCCode(
    api.party.openCredits({ orgSlug: beta.slug, partyId: alphaParty.id, side: "receivable" }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    api.party.openItems({ orgSlug: beta.slug, partyId: alphaParty.id, side: "receivable" }),
    "NOT_FOUND",
  );
  // Beta's own income account passes validation, so only the tenant predicate refuses it.
  await expectORPCCode(
    api.item.update({
      orgSlug: beta.slug,
      itemId: alphaItem.id,
      updatedAt: alphaItem.updatedAt.toISOString(),
      name: "Shared Service",
      unitPrice: "5.00",
      incomeAccountId: betaIncome.id,
    }),
    "CONFLICT",
  );
  await expectORPCCode(
    api.item.setActive({
      orgSlug: beta.slug,
      itemId: alphaItem.id,
      updatedAt: alphaItem.updatedAt.toISOString(),
      active: false,
    }),
    "CONFLICT",
  );
  await expectORPCCode(
    api.invoice.get({ orgSlug: beta.slug, invoiceId: alphaInvoice.id }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    api.allocation.reverse({
      orgSlug: beta.slug,
      allocationId: required(alphaAllocations[0], "alpha allocation").id,
      reason: "cross-org attempt",
    }),
    "CONFLICT",
  );
  await expectReason(
    api.allocation.apply({
      orgSlug: beta.slug,
      sourceDocumentId: alphaReceipt.id,
      targetDocumentId: betaInvoice.id,
      amount: "1.00",
    }),
    "ALLOCATION_SOURCE_INVALID",
  );
  await expectORPCCode(
    api.journal.get({ orgSlug: beta.slug, journalId: alphaJournal.id }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    api.journal.cancel({
      orgSlug: beta.slug,
      journalId: alphaJournal.id,
      reason: "cross-org attempt",
    }),
    "CONFLICT",
  );
  await expectReason(
    api.journal.post({
      orgSlug: beta.slug,
      documentDate: "2026-04-01",
      narration: "Foreign account",
      lines: [
        { accountId: alphaCash.id, side: "debit", amount: "1.00" },
        { accountId: betaIncome.id, side: "credit", amount: "1.00" },
      ],
    }),
    "ACCOUNT_INVALID",
  );
  await expectReason(
    api.journal.post({
      orgSlug: beta.slug,
      documentDate: "2026-04-01",
      narration: "Foreign party",
      lines: [
        {
          accountId: betaCash.id,
          partyId: alphaParty.id,
          side: "debit",
          amount: "1.00",
        },
        { accountId: betaIncome.id, side: "credit", amount: "1.00" },
      ],
    }),
    "PARTY_INVALID",
  );

  const [alphaUnappliedAfter, betaUnappliedAfter] = await Promise.all([
    api.party.openCredits({ orgSlug: alpha.slug, partyId: alphaParty.id, side: "receivable" }),
    api.party.openCredits({ orgSlug: beta.slug, partyId: betaParty.id, side: "receivable" }),
  ]);

  expect(alphaUnappliedAfter.rows).toEqual(alphaUnapplied.rows);
  expect(betaUnappliedAfter.rows).toEqual(betaUnapplied.rows);
});

test("operators are denied audit:read, the denial is recorded, and the owner sees only their org", async () => {
  const owner = await createTestUser("owner");
  const organization = await createOrganization(owner, "delta");
  const member = await createTestUser("member");
  await joinOrganization(member, organization.id);

  await expectORPCCode(clientFor(member).audit.list({ orgSlug: organization.slug }), "FORBIDDEN");

  const ownerClient = clientFor(owner);

  const denial = await eventually(async () => {
    const audit = await ownerClient.audit.list({ orgSlug: organization.slug });

    for (const entry of audit.items) {
      expect(entry.orgId).toBe(organization.id);
    }

    return audit.items.find(
      (entry) => entry.action === "rbac.permission" && entry.actorId === member.user.id,
    );
  });

  expect(denial.denied).toBe(true);
});

test("settings writes are owner-gated while reads are org-wide", async () => {
  const owner = await createTestUser("settings-gate-owner");
  const organization = await createOrganization(owner, "settings-gate");
  const person = await createTestUser("settings-gate-member");
  await joinOrganization(person, organization.id);

  const personClient = clientFor(person);
  const seen = await personClient.settings.get({ orgSlug: organization.slug });
  expect(seen.receiptPrefix).toBe("RCT");

  await expectORPCCode(
    personClient.settings.update({ orgSlug: organization.slug, ...seen, legalName: "denied" }),
    "FORBIDDEN",
  );

  const membership = await clientFor(owner).member.list({ orgSlug: organization.slug });
  const row = membership.members.find((m) => m.userId === person.user.id);
  await setMemberRoles(owner, required(row, "settings member").id, ["owner"], organization.id);

  const saved = await personClient.settings.update({
    orgSlug: organization.slug,
    ...seen,
    legalName: "now allowed",
  });

  expect(saved.legalName).toBe("now allowed");
});

test("the audit trail pages by a stable tenant-scoped cursor", async () => {
  const owner = await createTestUser("audit-pages");
  const organization = await createOrganization(owner, "audit-pages");
  const api = clientFor(owner);

  for (const index of [1, 2, 3]) {
    await api.member.invite({
      orgSlug: organization.slug,
      email: `audit-page-${index}-${uniqueSuffix()}@example.com`,
      role: "operator",
    });
  }

  await drainAuditWrites();

  const first = await api.audit.list({ orgSlug: organization.slug, limit: 2 });
  expect(first.items).toHaveLength(2);
  expect(first.nextCursor).not.toBeNull();

  const second = await api.audit.list({
    orgSlug: organization.slug,
    limit: 2,
    cursor: first.nextCursor!,
  });

  expect(second.items).toHaveLength(1);
  const firstIds = first.items.map((entry) => entry.id);
  expect(firstIds).not.toContain(second.items[0]!.id);
});

test("an operator,accountant holder gets the union of both roles' permissions", async () => {
  const owner = await createTestUser("owner");
  const organization = await createOrganization(owner, "union");
  const person = await createTestUser("member");
  await joinOrganization(person, organization.id);

  const personClient = clientFor(person);

  await expectORPCCode(personClient.audit.list({ orgSlug: organization.slug }), "FORBIDDEN");

  const membership = await clientFor(owner).member.list({
    orgSlug: organization.slug,
  });

  const row = membership.members.find((m) => m.userId === person.user.id);
  await setMemberRoles(
    owner,
    required(row, "multi-role member").id,
    ["operator", "accountant"],
    organization.id,
  );

  // Reading only the first stored role would leave this denied.
  const ownDenial = await eventually(async () => {
    const audit = await personClient.audit.list({ orgSlug: organization.slug });

    return audit.items.find(
      (entry) => entry.action === "rbac.permission" && entry.actorId === person.user.id,
    );
  });

  expect(ownDenial.orgId).toBe(organization.id);
  expect(ownDenial.denied).toBe(true);
});

test("an org slug is immutable, so the tenant claim can never be re-pointed", async () => {
  const owner = await createTestUser("slug-lock");
  const organization = await createOrganization(owner, "slug-lock");

  await expectAuthStatus(
    auth.api.updateOrganization({
      body: {
        organizationId: organization.id,
        data: { slug: `${organization.slug}-renamed` },
      },
      headers: owner.headers,
    }),
    "BAD_REQUEST",
  );

  const api = clientFor(owner);
  await api.settings.get({ orgSlug: organization.slug });
  await auth.api.updateOrganization({
    body: { organizationId: organization.id, data: { name: "Renamed" } },
    headers: owner.headers,
  });
  await api.settings.get({ orgSlug: organization.slug });
});

test("an unknown slug is FORBIDDEN, not NOT_FOUND — existence never leaks", async () => {
  const user = await createTestUser("unknown-slug");
  const organization = await createOrganization(user, "unknown-slug");
  const api = clientFor(user);

  // Identical to a real-but-foreign org, so a caller cannot probe which slugs exist.
  await expectORPCCode(api.settings.get({ orgSlug: `absent-${uniqueSuffix()}` }), "FORBIDDEN");
  await api.settings.get({ orgSlug: organization.slug });
});

// Compared against `appRouter` below, so a new procedure that is not listed here
// fails the suite rather than going uncovered.
const GUARDED_CALLS = {
  "party.create": (api, claim) =>
    api.party.create({
      ...claim,
      name: "Intrusion",
      roles: ["customer"],
      stateCode: "27",
    }),
  "party.update": (api, claim) =>
    api.party.update({
      ...claim,
      partyId: crypto.randomUUID(),
      name: "Intrusion",
      roles: ["customer"],
      stateCode: "27",
      active: true,
      allowNamesake: false,
      updatedAt: new Date().toISOString(),
    }),
  "party.get": (api, claim) => api.party.get({ ...claim, partyId: crypto.randomUUID() }),
  "party.list": (api, claim) => api.party.list({ ...claim }),
  "party.statement": (api, claim) =>
    api.party.statement({ ...claim, partyId: crypto.randomUUID() }),
  "account.list": (api, claim) => api.account.list({ ...claim }),
  "paymentMethod.list": (api, claim) => api.paymentMethod.list({ ...claim }),
  "paymentMethod.create": (api, claim) =>
    api.paymentMethod.create({ ...claim, name: "Intrusion", accountId: crypto.randomUUID() }),
  "paymentMethod.setActive": (api, claim) =>
    api.paymentMethod.setActive({ ...claim, paymentMethodId: crypto.randomUUID(), active: false }),
  "account.create": (api, claim) =>
    api.account.create({ ...claim, parent: { type: "asset" }, name: "Intrusion" }),
  "account.update": (api, claim) =>
    api.account.update({
      ...claim,
      accountId: crypto.randomUUID(),
      name: "Intrusion",
      updatedAt: new Date().toISOString(),
    }),
  "account.setActive": (api, claim) =>
    api.account.setActive({ ...claim, accountId: crypto.randomUUID(), active: false }),
  "account.moneyBalances": (api, claim) => api.account.moneyBalances({ ...claim }),
  "item.list": (api, claim) => api.item.list({ ...claim }),
  "item.create": (api, claim) =>
    api.item.create({
      ...claim,
      name: "Intrusion",
      unitPrice: "1.00",
      incomeAccountId: crypto.randomUUID(),
    }),
  "item.update": (api, claim) =>
    api.item.update({
      ...claim,
      itemId: crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
      name: "Intrusion",
      unitPrice: "1.00",
      incomeAccountId: crypto.randomUUID(),
    }),
  "item.setActive": (api, claim) =>
    api.item.setActive({
      ...claim,
      itemId: crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
      active: false,
    }),
  "item.taxRates": (api, claim) => api.item.taxRates({ ...claim }),
  "invoice.saveDraft": (api, claim) =>
    api.invoice.saveDraft({
      ...claim,
      partyId: crypto.randomUUID(),
      placeOfSupplyStateCode: "27",
      lines: [{ kind: "item", itemId: crypto.randomUUID(), quantity: 1 }],
    }),
  "invoice.post": (api, claim) =>
    api.invoice.post({
      ...claim,
      partyId: crypto.randomUUID(),
      placeOfSupplyStateCode: "27",
      lines: [{ kind: "item", itemId: crypto.randomUUID(), quantity: 1 }],
    }),
  "invoice.get": (api, claim) => api.invoice.get({ ...claim, invoiceId: crypto.randomUUID() }),
  "invoice.list": (api, claim) => api.invoice.list({ ...claim }),
  "invoice.amend": (api, claim) =>
    api.invoice.amend({ ...claim, invoiceId: crypto.randomUUID(), reason: "intrusion" }),
  "invoice.cancel": (api, claim) =>
    api.invoice.cancel({ ...claim, invoiceId: crypto.randomUUID(), reason: "intrusion" }),
  "invoice.discardDraft": (api, claim) =>
    api.invoice.discardDraft({ ...claim, draft: { id: crypto.randomUUID(), version: 1 } }),
  "receipt.post": (api, claim) =>
    api.receipt.post({
      ...claim,
      settlementKind: "direct",
      amount: "1.00",
      paymentMethodId: crypto.randomUUID(),
      incomeAccountId: crypto.randomUUID(),
    }),
  "receipt.get": (api, claim) => api.receipt.get({ ...claim, receiptId: crypto.randomUUID() }),
  "receipt.list": (api, claim) => api.receipt.list({ ...claim }),
  "receipt.partyTotals": (api, claim) => api.receipt.partyTotals({ ...claim }),
  "party.openItems": (api, claim) =>
    api.party.openItems({ ...claim, partyId: crypto.randomUUID(), side: "receivable" }),
  "party.openCredits": (api, claim) =>
    api.party.openCredits({ ...claim, partyId: crypto.randomUUID(), side: "payable" }),
  "bill.saveDraft": (api, claim) =>
    api.bill.saveDraft({
      ...claim,
      partyId: crypto.randomUUID(),
      lines: [
        { accountId: crypto.randomUUID(), description: "x", amount: "1.00", itcEligible: false },
      ],
    }),
  "bill.post": (api, claim) =>
    api.bill.post({
      ...claim,
      partyId: crypto.randomUUID(),
      reference: "INV-1",
      lines: [
        { accountId: crypto.randomUUID(), description: "x", amount: "1.00", itcEligible: false },
      ],
    }),
  "bill.get": (api, claim) => api.bill.get({ ...claim, billId: crypto.randomUUID() }),
  "bill.list": (api, claim) => api.bill.list({ ...claim }),
  "bill.cancel": (api, claim) =>
    api.bill.cancel({ ...claim, billId: crypto.randomUUID(), reason: "intrusion" }),
  "bill.discardDraft": (api, claim) =>
    api.bill.discardDraft({ ...claim, draft: { id: crypto.randomUUID(), version: 1 } }),
  "bill.amend": (api, claim) =>
    api.bill.amend({ ...claim, billId: crypto.randomUUID(), reason: "intrusion" }),
  "note.post": (api, claim) =>
    api.note.post({
      ...claim,
      type: "creditNote",
      againstDocumentId: crypto.randomUUID(),
      narration: "Intrusion",
      lines: [{ sourceLineId: crypto.randomUUID(), amount: "1.00" }],
    }),
  "note.get": (api, claim) => api.note.get({ ...claim, noteId: crypto.randomUUID() }),
  "note.list": (api, claim) => api.note.list({ ...claim }),
  "note.cancel": (api, claim) =>
    api.note.cancel({ ...claim, noteId: crypto.randomUUID(), reason: "intrusion" }),
  "journal.post": (api, claim) =>
    api.journal.post({
      ...claim,
      documentDate: "2026-04-01",
      narration: "Intrusion",
      lines: [
        { accountId: crypto.randomUUID(), side: "debit", amount: "1.00" },
        { accountId: crypto.randomUUID(), side: "credit", amount: "1.00" },
      ],
    }),
  "journal.get": (api, claim) => api.journal.get({ ...claim, journalId: crypto.randomUUID() }),
  "journal.list": (api, claim) => api.journal.list({ ...claim }),
  "journal.accounts": (api, claim) => api.journal.accounts({ ...claim }),
  "journal.cancel": (api, claim) =>
    api.journal.cancel({ ...claim, journalId: crypto.randomUUID(), reason: "Intrusion" }),
  "lock.get": (api, claim) => api.lock.get({ ...claim }),
  "lock.set": (api, claim) =>
    api.lock.set({
      ...claim,
      kind: "general",
      lockedThrough: "2026-03-31",
      expectedLockedThrough: null,
      reason: "Intrusion",
    }),
  "lock.grantException": (api, claim) =>
    api.lock.grantException({
      ...claim,
      userId: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      reason: "Intrusion",
    }),
  "lock.revokeException": (api, claim) =>
    api.lock.revokeException({
      ...claim,
      exceptionId: crypto.randomUUID(),
      reason: "Intrusion",
    }),
  "openingBalance.post": (api, claim) =>
    api.openingBalance.post({
      ...claim,
      documentDate: "2026-04-01",
      lines: [
        { accountId: crypto.randomUUID(), side: "debit", amount: "1.00" },
        { accountId: crypto.randomUUID(), side: "credit", amount: "1.00" },
      ],
    }),
  "openingBalance.get": (api, claim) => api.openingBalance.get({ ...claim }),
  "openingBalance.cancel": (api, claim) =>
    api.openingBalance.cancel({
      ...claim,
      openingBalanceId: crypto.randomUUID(),
      reason: "Intrusion",
    }),
  "allocation.apply": (api, claim) =>
    api.allocation.apply({
      ...claim,
      sourceDocumentId: crypto.randomUUID(),
      targetDocumentId: crypto.randomUUID(),
      amount: "1.00",
    }),
  "allocation.reverse": (api, claim) =>
    api.allocation.reverse({
      ...claim,
      allocationId: crypto.randomUUID(),
      reason: "intrusion",
    }),
  "receipt.cancel": (api, claim) =>
    api.receipt.cancel({ ...claim, receiptId: crypto.randomUUID(), reason: "intrusion" }),
  "export.dayBookXlsx": (api, claim) => api.export.dayBookXlsx({ ...claim, date: "2026-09-12" }),
  "payment.post": (api, claim) =>
    api.payment.post({
      ...claim,
      settlementKind: "direct",
      amount: "1.00",
      paymentMethodId: crypto.randomUUID(),
      expenseAccountId: crypto.randomUUID(),
    }),
  "payment.get": (api, claim) => api.payment.get({ ...claim, paymentId: crypto.randomUUID() }),
  "payment.list": (api, claim) => api.payment.list({ ...claim }),
  "payment.tdsSections": (api, claim) => api.payment.tdsSections({ ...claim }),
  "payment.cancel": (api, claim) =>
    api.payment.cancel({ ...claim, paymentId: crypto.randomUUID(), reason: "intrusion" }),
  "export.tdsRegisterXlsx": (api, claim) =>
    api.export.tdsRegisterXlsx({ ...claim, from: "2026-09-01", to: "2026-09-30" }),
  "export.gstOutwardXlsx": (api, claim) =>
    api.export.gstOutwardXlsx({ ...claim, from: "2026-09-01", to: "2026-09-30" }),
  "export.gstInwardXlsx": (api, claim) =>
    api.export.gstInwardXlsx({ ...claim, from: "2026-09-01", to: "2026-09-30" }),
  "settings.get": (api, claim) => api.settings.get({ ...claim }),
  "settings.update": (api, claim) =>
    api.settings.update({
      ...claim,
      legalName: "intrusion",
      pan: "ABCDE1234F",
      stateCode: "27",
      addressLine1: "1 Intrusion Street",
      city: "Pune",
      pinCode: "411001",
      financialYearStart: 4,
      timeZone: "Asia/Kolkata",
      invoicePrefix: "INV",
      billPrefix: "BILL",
      receiptPrefix: "RCT",
      paymentPrefix: "PMT",
      journalPrefix: "JV",
      creditNotePrefix: "CN",
      debitNotePrefix: "DN",
    }),
  "audit.list": (api, claim) => api.audit.list({ ...claim }),
  "file.list": (api, claim) => api.file.list({ ...claim }),
  "file.createUpload": (api, claim) =>
    api.file.createUpload({ ...claim, name: "intrusion.txt", size: 1 }),
  "file.finalizeUpload": (api, claim) => api.file.finalizeUpload({ ...claim, key: "k" }),
  "file.getReadUrl": (api, claim) => api.file.getReadUrl({ ...claim, key: "k" }),
  "file.delete": (api, claim) => api.file.delete({ ...claim, key: "k" }),
  "member.me": (api, claim) => api.member.me({ ...claim }),
  "member.list": (api, claim) => api.member.list({ ...claim }),
  "member.options": (api, claim) => api.member.options({ ...claim }),
  "member.invite": (api, claim) =>
    api.member.invite({ ...claim, email: "x@example.com", role: "operator" }),
  "member.revokeInvitation": (api, claim) =>
    api.member.revokeInvitation({ ...claim, invitationId: "i" }),
  "member.updateRole": (api, claim) =>
    api.member.updateRole({ ...claim, memberId: "m", role: "accountant" }),
  "member.remove": (api, claim) => api.member.remove({ ...claim, memberId: "m" }),
} satisfies Record<string, (api: AppRouterClient, claim: { orgSlug: string }) => Promise<unknown>>;

// SAFETY: Deliberately omit the required tenant claim to exercise runtime validation.
const NO_CLAIM = {} as Parameters<AppRouterClient["member"]["me"]>[0];

// Bootstrap creation is guarded by sessionProcedure and deliberately has no
// organization claim yet; every other procedure must appear in GUARDED_CALLS.
const SESSION_ONLY_PROCEDURES = new Set(["organization.create"]);

test("the guarded-call table covers every organization-scoped procedure in the router", () => {
  const procedures = Object.entries(appRouter)
    .flatMap(([namespace, router]) => Object.keys(router).map((name) => `${namespace}.${name}`))
    .sort();

  const sessionOnly = procedures.filter((procedure) => SESSION_ONLY_PROCEDURES.has(procedure));
  const orgScoped = procedures.filter((procedure) => !SESSION_ONLY_PROCEDURES.has(procedure));

  expect(sessionOnly).toEqual([...SESSION_ONLY_PROCEDURES].sort());
  expect(Object.keys(GUARDED_CALLS).sort()).toEqual(orgScoped);
});

test("every procedure is FORBIDDEN when an outsider names a foreign org", async () => {
  const owner = await createTestUser("sweep-owner");
  const organization = await createOrganization(owner, "sweep");
  const outsider = await createTestUser("sweep-outsider");
  const api = clientFor(outsider);

  for (const [name, call] of Object.entries(GUARDED_CALLS)) {
    await expectORPCCode(call(api, { orgSlug: organization.slug }), "FORBIDDEN", name);
  }

  await drainAuditWrites();
  const audit = await clientFor(owner).audit.list({ orgSlug: organization.slug });
  expect(audit.items.some((entry) => entry.actorId === outsider.user.id)).toBe(false);
});

test("every procedure rejects a missing org claim as BAD_REQUEST, not FORBIDDEN", async () => {
  const user = await createTestUser("no-claim");
  const api = clientFor(user);

  // a missing claim fails validation, not authorization — so the code, not
  // merely the rejection, is what is asserted.
  for (const [name, call] of Object.entries(GUARDED_CALLS)) {
    await expectORPCCode(call(api, NO_CLAIM), "BAD_REQUEST", name);
  }
});

test("every procedure is FORBIDDEN for a removed member on the very next request", async () => {
  const owner = await createTestUser("revoked-owner");
  const organization = await createOrganization(owner, "revoked");
  const member = await createTestUser("revoked-member");
  await joinOrganization(member, organization.id);

  const memberClient = clientFor(member);
  // Control case: without it the sweep below would pass against a user who never
  // joined at all.
  const before = await memberClient.settings.get({ orgSlug: organization.slug });
  expect(before.receiptPrefix).toBe("RCT");

  await removeFromOrganization(owner, member.user.email, organization.id);

  for (const [name, call] of Object.entries(GUARDED_CALLS)) {
    await expectORPCCode(call(memberClient, { orgSlug: organization.slug }), "FORBIDDEN", name);
  }
});

test("member mutations reject an id belonging to another tenant", async () => {
  const alice = await createTestUser("member-scope-alice");
  const alpha = await createOrganization(alice, "member-scope-alpha");
  const bob = await createTestUser("member-scope-bob");
  const beta = await createOrganization(bob, "member-scope-beta");

  const stranger = await createTestUser("member-scope-stranger");
  await joinOrganization(stranger, alpha.id);

  const [inAlpha] = (await clientFor(alice).member.list({ orgSlug: alpha.slug })).members.filter(
    (row) => row.userId === stranger.user.id,
  );

  expect(inAlpha).toBeDefined();

  // Bob owns beta, so the guard passes — only the scoped pre-read stops alpha's
  // member id reaching Better Auth.
  const bobClient = clientFor(bob);
  await expectORPCCode(
    bobClient.member.updateRole({ orgSlug: beta.slug, memberId: inAlpha!.id, role: "accountant" }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    bobClient.member.remove({ orgSlug: beta.slug, memberId: inAlpha!.id }),
    "NOT_FOUND",
  );

  const stillThere = (await clientFor(alice).member.list({ orgSlug: alpha.slug })).members;
  expect(stillThere.map((row) => row.userId)).toContain(stranger.user.id);
  expect(stillThere.find((row) => row.userId === stranger.user.id)?.role).toBe("operator");
});

test("an invitation id from another tenant cannot be revoked", async () => {
  const alice = await createTestUser("invite-scope-alice");
  const alpha = await createOrganization(alice, "invite-scope-alpha");
  const bob = await createTestUser("invite-scope-bob");
  const beta = await createOrganization(bob, "invite-scope-beta");

  const invited = await clientFor(alice).member.invite({
    orgSlug: alpha.slug,
    email: `scoped-${Bun.randomUUIDv7()}@example.com`,
    role: "operator",
  });

  await expectORPCCode(
    clientFor(bob).member.revokeInvitation({ orgSlug: beta.slug, invitationId: invited.id }),
    "NOT_FOUND",
  );

  const stillPending = await clientFor(alice).member.list({ orgSlug: alpha.slug });
  expect(stillPending.invitations.map((row) => row.id)).toContain(invited.id);
});

test("the roster pages members by keyset; invitations ride the first page", async () => {
  const owner = await createTestUser("roster-page-owner");
  const organization = await createOrganization(owner, "roster-page");
  const person = await createTestUser("roster-page-member");
  await joinOrganization(person, organization.id);

  const api = clientFor(owner);

  const invited = await api.member.invite({
    orgSlug: organization.slug,
    email: `roster-${Bun.randomUUIDv7()}@example.com`,
    role: "operator",
  });

  const first = await api.member.list({ orgSlug: organization.slug, limit: 1 });
  expect(first.members.map((row) => row.userId)).toEqual([owner.user.id]);
  expect(first.hasMore).toBe(true);
  expect(first.invitations.map((row) => row.id)).toEqual([invited.id]);

  const cursor = required(first.members[0], "first page member").id;
  const next = await api.member.list({ orgSlug: organization.slug, limit: 1, cursor });
  expect(next).toMatchObject({ hasMore: false, invitations: [] });
  expect(next.members.map((row) => row.userId)).toEqual([person.user.id]);
});
