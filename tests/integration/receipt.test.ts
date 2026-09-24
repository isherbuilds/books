import { beforeAll, expect, test } from "bun:test";

import type { AppRouterClient } from "@accly/api/routers/index";
import { db } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { auditLog } from "@accly/db/schema/audit";
import { documentLines } from "@accly/db/schema/document-lines";
import { paymentMethods } from "@accly/db/schema/payment-methods";
import { and, eq } from "drizzle-orm";

import { createAccountingFixture, postingOf } from "../support/accounting";
import { required } from "../support/assert";
import {
  createAccountingOrganization,
  createFounderSession,
  createTestUser,
  joinOrganization,
  type TestUser,
} from "../support/auth";
import { clientFor, eventually, expectORPCCode, expectReason } from "../support/client";
import { resetTestDatabase } from "../support/database";
import { uniqueSuffix } from "../support/unique";
import { readZipText } from "../support/xlsx";

type ReceiptDetail = Awaited<ReturnType<AppRouterClient["receipt"]["get"]>>;

function linesOf(documentId: string) {
  return db
    .select()
    .from(documentLines)
    .where(and(eq(documentLines.orgId, organization.id), eq(documentLines.documentId, documentId)));
}

type ReceiptPostInput = Parameters<AppRouterClient["receipt"]["post"]>[0];

type Account = typeof accounts.$inferSelect;

type PaymentMethod = typeof paymentMethods.$inferSelect;

let founder: TestUser;

let organization: { id: string; slug: string };

let api: AppRouterClient;

let party: { id: string; updatedAt: Date };

let customerAdvances: Account;

let bankGroup: Account;

let bankAccount: Account;

let cashAccount: Account;

let exemptIncome: Account;

let taxableIncome: Account;

let bankTransfer: PaymentMethod;

let cashMethod: PaymentMethod;

let primaryReceipt: ReceiptDetail;

let primaryPosting: Awaited<ReturnType<typeof postingOf>>;

let originalLegalName: string;

beforeAll(async () => {
  await resetTestDatabase();
  founder = await createFounderSession();

  const fixture = await createAccountingFixture(founder, "receipt");
  organization = fixture.organization;
  api = fixture.api;

  customerAdvances = required(
    fixture.accounts.find(({ systemKey }) => systemKey === "customerAdvances"),
    "customer advances account",
  );
  bankGroup = required(
    fixture.accounts.find(({ systemKey }) => systemKey === "bank"),
    "bank account group",
  );
  bankAccount = required(
    fixture.accounts.find(({ code }) => code === "1101"),
    "bank account",
  );
  cashAccount = required(
    fixture.accounts.find(({ code }) => code === "1001"),
    "cash account",
  );
  exemptIncome = required(
    fixture.accounts.find(({ type, supplyClass }) => type === "income" && supplyClass === "exempt"),
    "exempt income account",
  );
  taxableIncome = required(
    fixture.accounts.find(
      ({ type, supplyClass }) => type === "income" && supplyClass === "taxable",
    ),
    "taxable income account",
  );
  bankTransfer = required(
    fixture.methods.find(({ name }) => name === "Bank transfer"),
    "bank transfer payment method",
  );
  cashMethod = required(
    fixture.methods.find(({ name }) => name === "Cash"),
    "cash payment method",
  );
  party = await api.party.create({
    orgSlug: organization.slug,
    name: "Receipt Customer",
    roles: ["customer"],
    stateCode: "27",
    addressLine1: "2 Customer Road",
    city: "Pune",
    pinCode: "411001",
  });
  originalLegalName = (await api.organization.getProfile({ orgSlug: organization.slug })).legalName;

  const posted = await api.receipt.post({
    orgSlug: organization.slug,
    settlementKind: "advance",
    advanceSupply: "exempt",
    partyId: party.id,
    amount: "1250.50",
    paymentMethodId: bankTransfer.id,
    reference: "UTR1",
    documentDate: "2026-09-12",
  });

  primaryReceipt = await api.receipt.get({ orgSlug: organization.slug, receiptId: posted.id });
  primaryPosting = await postingOf(organization.id, primaryReceipt.id, "post");
});

test("advance receipt posts to customer advances, numbers, and audit", async () => {
  expect(primaryReceipt).toMatchObject({
    state: "posted",
    number: "RCT26-27/1",
    totalPaise: 125_050n,
  });
  expect(typeof primaryReceipt.totalPaise).toBe("bigint");
  expect(primaryReceipt.printSnapshot?.party?.name).toBe("Receipt Customer");
  expect(await linesOf(primaryReceipt.id)).toEqual([
    expect.objectContaining({
      kind: "account",
      accountId: null,
      description: "Advance received",
      amountPaise: 125_050n,
    }),
  ]);

  expect(primaryPosting.entry.documentType).toBe("receipt");
  expect(primaryPosting.lines).toHaveLength(2);
  expect(primaryPosting.lines).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        accountId: bankAccount.id,
        partyId: null,
        debit: 125_050n,
        credit: 0n,
      }),
      expect.objectContaining({
        accountId: customerAdvances.id,
        partyId: party.id,
        debit: 0n,
        credit: 125_050n,
      }),
    ]),
  );
  expect(primaryPosting.ledger).toEqual([
    expect.objectContaining({
      partyId: party.id,
      side: "receivable",
      kind: "post",
      amountPaise: -125_050n,
    }),
  ]);

  const auditEntry = await eventually(async () => {
    const rows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.orgId, organization.id), eq(auditLog.action, "receipt.post")));

    return rows.find(({ meta }) => meta?.amount === "1250.50");
  });

  expect(auditEntry.meta?.amount).toBe("1250.50");
  expect(typeof auditEntry.meta?.amount).toBe("string");

  const second = await api.receipt.post({
    orgSlug: organization.slug,
    settlementKind: "direct",
    amount: "1250.50",
    paymentMethodId: cashMethod.id,
    incomeAccountId: exemptIncome.id,
    reference: "UTR2",
    documentDate: "2026-09-12",
  });

  expect(second.number).toBe("RCT26-27/2");
});

test("direct receipt credits exempt income without creating party exposure", async () => {
  const { id } = await api.receipt.post({
    orgSlug: organization.slug,
    settlementKind: "direct",
    amount: "75.25",
    paymentMethodId: cashMethod.id,
    incomeAccountId: exemptIncome.id,
    narration: "Interest received",
    documentDate: "2026-09-12",
  });

  const receipt = await api.receipt.get({ orgSlug: organization.slug, receiptId: id });

  expect(receipt.affectsTax).toBe(false);
  expect(receipt.printSnapshot?.party).toBeNull();
  expect(await linesOf(receipt.id)).toEqual([
    expect.objectContaining({ accountId: exemptIncome.id, description: "Interest received" }),
  ]);

  const posting = await postingOf(organization.id, receipt.id, "post");

  expect(posting.lines).toContainEqual(
    expect.objectContaining({ accountId: exemptIncome.id, debit: 0n, credit: 7_525n }),
  );
  expect(posting.ledger).toHaveLength(0);
});

test("receipt post rejects invalid settlements and enforces advance supply policy", async () => {
  const directInput: ReceiptPostInput = {
    orgSlug: organization.slug,
    settlementKind: "direct",
    amount: "10.00",
    paymentMethodId: cashMethod.id,
    incomeAccountId: exemptIncome.id,
  };

  await expectReason(
    api.receipt.post({ ...directInput, partyId: Bun.randomUUIDv7() }),
    "PARTY_INVALID",
  );

  const gstOrganization = await createAccountingOrganization(founder.headers, {
    slug: `receipt-gst-${uniqueSuffix()}`,
    gstin: "27ABCDE1234F1Z5",
    timeZone: "UTC",
  });

  const gstApi = clientFor(founder);

  const gstAccounts = await db
    .select()
    .from(accounts)
    .where(eq(accounts.orgId, gstOrganization.id));

  const gstTaxableIncome = required(
    gstAccounts.find(({ type, supplyClass }) => type === "income" && supplyClass === "taxable"),
    "GST taxable income",
  );

  const gstMethod = required(
    (await gstApi.paymentMethod.list({ orgSlug: gstOrganization.slug })).find(
      ({ name }) => name === "Cash",
    ),
    "GST cash method",
  );

  const gstParty = await gstApi.party.create({
    orgSlug: gstOrganization.slug,
    name: "GST Customer",
    roles: ["customer"],
    stateCode: "27",
  });

  await expectReason(
    gstApi.receipt.post({
      orgSlug: gstOrganization.slug,
      settlementKind: "direct",
      amount: "10.00",
      paymentMethodId: gstMethod.id,
      incomeAccountId: gstTaxableIncome.id,
    }),
    "TAXABLE_DIRECT_RECEIPT",
  );

  const gstAdvance: ReceiptPostInput = {
    orgSlug: gstOrganization.slug,
    settlementKind: "advance",
    advanceSupply: "taxableService",
    partyId: gstParty.id,
    amount: "10.00",
    paymentMethodId: gstMethod.id,
  };

  await expectReason(gstApi.receipt.post(gstAdvance), "ADVANCE_TAX_UNSUPPORTED");

  const { id: goodsAdvanceId } = await gstApi.receipt.post({
    ...gstAdvance,
    advanceSupply: "goods",
  });

  const goodsAdvance = await gstApi.receipt.get({
    orgSlug: gstAdvance.orgSlug,
    receiptId: goodsAdvanceId,
  });

  expect(goodsAdvance.state).toBe("posted");
  expect(goodsAdvance.advanceSupply).toBe("goods");
});

test("cancelling reverses stored lines once even after payment method remapping", async () => {
  await db
    .update(paymentMethods)
    .set({ accountId: cashAccount.id, updatedAt: new Date() })
    .where(and(eq(paymentMethods.orgId, organization.id), eq(paymentMethods.id, bankTransfer.id)));

  try {
    const cancelled = await api.receipt.cancel({
      orgSlug: organization.slug,
      receiptId: primaryReceipt.id,
      reason: "entered twice",
    });

    expect(cancelled.state).toBe("cancelled");

    const reversal = await postingOf(organization.id, primaryReceipt.id, "reverse");

    expect(reversal.entry.reversesEntryId).toBe(primaryPosting.entry.id);
    expect(reversal.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: bankAccount.id, debit: 0n, credit: 125_050n }),
        expect.objectContaining({
          accountId: customerAdvances.id,
          partyId: party.id,
          debit: 125_050n,
          credit: 0n,
        }),
      ]),
    );
    expect(reversal.lines.some(({ accountId }) => accountId === cashAccount.id)).toBe(false);
    expect(reversal.ledger).toContainEqual(
      expect.objectContaining({ kind: "reverse", amountPaise: 125_050n }),
    );

    await expect(
      api.receipt.cancel({
        orgSlug: organization.slug,
        receiptId: primaryReceipt.id,
        reason: "again",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  } finally {
    await db
      .update(paymentMethods)
      .set({ accountId: bankAccount.id, updatedAt: new Date() })
      .where(
        and(eq(paymentMethods.orgId, organization.id), eq(paymentMethods.id, bankTransfer.id)),
      );
  }
});

test("receipt detail preserves the posted party and organization print snapshot", async () => {
  const originalParty = await api.party.get({
    orgSlug: organization.slug,
    partyId: party.id,
  });

  const renamedParty = await api.party.update({
    orgSlug: organization.slug,
    partyId: party.id,
    name: "Renamed Customer",
    roles: ["customer"],
    stateCode: "27",
    addressLine1: "2 Customer Road",
    city: "Pune",
    pinCode: "411001",
    active: true,
    updatedAt: party.updatedAt.toISOString(),
  });

  const founderApi = clientFor(founder);
  const settings = await founderApi.settings.get({ orgSlug: organization.slug });
  await founderApi.settings.update({
    ...settings,
    orgSlug: organization.slug,
    legalName: "Renamed Organization Private Limited",
  });
  await db
    .update(paymentMethods)
    .set({ name: "Renamed method" })
    .where(and(eq(paymentMethods.orgId, organization.id), eq(paymentMethods.id, bankTransfer.id)));

  try {
    const reprint = await api.receipt.get({
      orgSlug: organization.slug,
      receiptId: primaryReceipt.id,
    });

    expect(reprint.printSnapshot?.party?.name).toBe("Receipt Customer");
    expect(reprint.printSnapshot?.organization.legalName).toBe(originalLegalName);
    expect(reprint.printSnapshot?.paymentMethod).toBe("Bank transfer");
    expect(reprint.printSnapshot?.lines).toEqual([{ description: expect.any(String) }]);
  } finally {
    await api.party.update({
      orgSlug: organization.slug,
      partyId: originalParty.id,
      name: originalParty.name,
      roles: originalParty.roles,
      gstin: originalParty.gstin ?? undefined,
      pan: originalParty.pan ?? undefined,
      stateCode: originalParty.stateCode,
      addressLine1: originalParty.addressLine1 ?? undefined,
      addressLine2: originalParty.addressLine2 ?? undefined,
      city: originalParty.city ?? undefined,
      pinCode: originalParty.pinCode ?? undefined,
      email: originalParty.email ?? undefined,
      phone: originalParty.phone ?? undefined,
      active: originalParty.active,
      updatedAt: renamedParty.updatedAt.toISOString(),
    });
    await founderApi.settings.update({ ...settings, orgSlug: organization.slug });
    await db
      .update(paymentMethods)
      .set({ name: bankTransfer.name })
      .where(
        and(eq(paymentMethods.orgId, organization.id), eq(paymentMethods.id, bankTransfer.id)),
      );
  }
});

test("a second bank account takes its own method, receipts and balance", async () => {
  const orgSlug = organization.slug;

  await expectReason(
    api.paymentMethod.create({ orgSlug, name: "Not money", accountId: customerAdvances.id }),
    "ACCOUNT_NOT_MONEY",
  );

  const icici = await api.account.create({
    orgSlug,
    parent: { accountId: bankGroup.id },
    name: "ICICI Bank",
  });

  const iciciNeft = await api.paymentMethod.create({
    orgSlug,
    name: "ICICI NEFT",
    accountId: icici.id,
  });

  expect(icici).toMatchObject({ code: "1102", parentId: bankAccount.parentId, type: "asset" });
  expect(iciciNeft.accountId).toBe(icici.id);

  const intoIcici: ReceiptPostInput = {
    orgSlug,
    settlementKind: "direct",
    amount: "500.00",
    paymentMethodId: iciciNeft.id,
    incomeAccountId: exemptIncome.id,
    documentDate: "2026-09-12",
  };

  await api.receipt.post(intoIcici);

  const balances = await api.account.moneyBalances({ orgSlug });
  expect(balances.find(({ id }) => id === icici.id)).toMatchObject({
    groupName: "Bank Accounts",
    balancePaise: 50_000n,
  });

  await api.paymentMethod.setActive({ orgSlug, paymentMethodId: iciciNeft.id, active: false });
  await expectReason(api.receipt.post(intoIcici), "PAYMENT_METHOD_INVALID");

  // Restoring a method never restores its account; posting refuses the archived one.
  await api.account.setActive({ orgSlug, accountId: icici.id, active: false });
  await api.paymentMethod.setActive({ orgSlug, paymentMethodId: iciciNeft.id, active: true });
  expect(
    (await api.paymentMethod.list({ orgSlug })).find(({ id }) => id === iciciNeft.id),
  ).toMatchObject({ active: true, accountActive: false });
  await expectReason(api.receipt.post(intoIcici), "PAYMENT_METHOD_INVALID");
  expect(
    (await api.account.moneyBalances({ orgSlug })).find(({ id }) => id === icici.id),
  ).toMatchObject({ balancePaise: 50_000n });
});

test("a new prefix starts its own series, stored in upper case", async () => {
  const orgSlug = organization.slug;
  const founderApi = clientFor(founder);
  const settings = await founderApi.settings.get({ orgSlug });

  await founderApi.settings.update({ ...settings, orgSlug, receiptPrefix: "rc" });

  try {
    const posted = await api.receipt.post({
      orgSlug,
      settlementKind: "direct",
      amount: "10.00",
      paymentMethodId: cashMethod.id,
      incomeAccountId: exemptIncome.id,
      documentDate: "2026-09-12",
    });

    // The shared RCT counter would have printed RC26-27/4.
    expect(posted.number).toBe("RC26-27/1");
  } finally {
    await founderApi.settings.update({ ...settings, orgSlug });
  }
});

test("receipt queries filter by reference and hide cross-organization ids", async () => {
  const result = await api.receipt.list({ orgSlug: organization.slug, q: "UTR1" });
  expect(result.hasMore).toBe(false);
  expect(result.rows).toEqual([
    expect.objectContaining({
      id: primaryReceipt.id,
      reference: "UTR1",
      paymentMethodName: "Bank transfer",
    }),
  ]);

  const otherOrganization = await createAccountingOrganization(founder.headers, {
    slug: `receipt-other-${uniqueSuffix()}`,
  });

  const otherMember = await createTestUser(`receipt-other-member-${uniqueSuffix()}`);
  await joinOrganization(otherMember, otherOrganization.id, "accountant");
  await expectORPCCode(
    clientFor(otherMember).receipt.get({
      orgSlug: otherOrganization.slug,
      receiptId: primaryReceipt.id,
    }),
    "NOT_FOUND",
  );
});

test("operator may post but not cancel while a CA cannot post", async () => {
  const operator = await createTestUser(`receipt-operator-${uniqueSuffix()}`);
  const ca = await createTestUser(`receipt-ca-${uniqueSuffix()}`);
  await joinOrganization(operator, organization.id, "operator");
  await joinOrganization(ca, organization.id, "ca");

  const operatorReceipt = await clientFor(operator).receipt.post({
    orgSlug: organization.slug,
    settlementKind: "direct",
    amount: "1.00",
    paymentMethodId: cashMethod.id,
    incomeAccountId: taxableIncome.id,
    documentDate: "2026-09-12",
  });

  await expectORPCCode(
    clientFor(operator).receipt.cancel({
      orgSlug: organization.slug,
      receiptId: operatorReceipt.id,
      reason: "not permitted",
    }),
    "FORBIDDEN",
  );
  await expectORPCCode(
    clientFor(ca).receipt.post({
      orgSlug: organization.slug,
      settlementKind: "direct",
      amount: "1.00",
      paymentMethodId: cashMethod.id,
      incomeAccountId: taxableIncome.id,
    }),
    "FORBIDDEN",
  );
});

test("day book XLSX contains the receipt number and numeric rupee amount", async () => {
  const file = await api.export.dayBookXlsx({
    orgSlug: organization.slug,
    date: "2026-09-12",
  });

  expect(file).toBeInstanceOf(Blob);
  expect(file.name).toBe("day-book-2026-09-12.xlsx");
  expect(file.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

  const bytes = new Uint8Array(await file.arrayBuffer());
  expect(new TextDecoder().decode(bytes.subarray(0, 2))).toBe("PK");
  const sharedStrings = readZipText(bytes, "xl/sharedStrings.xml");
  const sheet = readZipText(bytes, "xl/worksheets/sheet1.xml");
  expect(sharedStrings).toContain("RCT26-27/1");
  expect(sheet).toMatch(/<v>1250\.5<\/v>/);
});

test("receipt list filters narrow the keyset and party totals count posted receipts only", async () => {
  const buyer = await api.party.create({
    orgSlug: organization.slug,
    name: `Filter Buyer ${uniqueSuffix()}`,
    roles: ["customer"],
    stateCode: "27",
  });

  type AdvanceOverrides = Partial<
    Pick<
      Extract<ReceiptPostInput, { settlementKind: "advance" }>,
      "amount" | "paymentMethodId" | "documentDate" | "reference" | "narration"
    >
  >;

  const post = (input: AdvanceOverrides) =>
    api.receipt.post({
      orgSlug: organization.slug,
      settlementKind: "advance",
      advanceSupply: "exempt",
      partyId: buyer.id,
      amount: "100.00",
      paymentMethodId: bankTransfer.id,
      documentDate: "2026-09-01",
      ...input,
    });

  const bank = await post({});

  const cash = await post({
    amount: "250.00",
    paymentMethodId: cashMethod.id,
    documentDate: "2026-09-05",
  });

  const direct = await api.receipt.post({
    orgSlug: organization.slug,
    settlementKind: "direct",
    partyId: buyer.id,
    paymentMethodId: bankTransfer.id,
    incomeAccountId: exemptIncome.id,
    amount: "40.00",
    documentDate: "2026-09-10",
  });

  await api.receipt.cancel({
    orgSlug: organization.slug,
    receiptId: cash.id,
    reason: "wrong till",
  });

  const byPartyName = await api.receipt.list({ orgSlug: organization.slug, q: buyer.name });

  expect(byPartyName.rows.map(({ id }) => id)).toEqual(
    expect.arrayContaining([direct.id, cash.id, bank.id]),
  );

  const firstPage = await api.receipt.list({
    orgSlug: organization.slug,
    partyId: buyer.id,
    limit: 1,
  });

  expect(firstPage.hasMore).toBe(true);

  const secondPage = await api.receipt.list({
    orgSlug: organization.slug,
    partyId: buyer.id,
    cursor: required(firstPage.rows[0], "first receipt page row").id,
    limit: 2,
  });

  expect(secondPage.rows.map(({ id }) => id)).toEqual([cash.id, bank.id]);
  expect(secondPage.hasMore).toBe(false);

  const ids = async (filters: Partial<Parameters<AppRouterClient["receipt"]["list"]>[0]>) =>
    (
      await api.receipt.list({ orgSlug: organization.slug, partyId: buyer.id, ...filters })
    ).rows.map(({ id }) => id);

  expect(await ids({ state: "cancelled" })).toEqual([cash.id]);
  expect(await ids({ from: "2026-09-02", to: "2026-09-09" })).toEqual([cash.id]);

  await expectORPCCode(
    api.receipt.list({ orgSlug: organization.slug, from: "2026-09-10", to: "2026-09-01" }),
    "BAD_REQUEST",
  );

  const totals = await api.receipt.partyTotals({ orgSlug: organization.slug });

  expect(totals.find((row) => row.partyId === buyer.id)).toEqual({
    partyId: buyer.id,
    receivedPaise: 14_000n,
  });

  expect(await api.receipt.partyTotals({ orgSlug: organization.slug, partyId: buyer.id })).toEqual([
    { partyId: buyer.id, receivedPaise: 14_000n },
  ]);

  // Advances are negative exposure; the cancelled one nets out; a direct receipt has
  // no exposure line.
  const statement = await api.party.statement({ orgSlug: organization.slug, partyId: buyer.id });

  expect(
    statement.lines.map(({ number, amountPaise, balancePaise }) => [
      number,
      amountPaise,
      balancePaise,
    ]),
  ).toEqual([
    [bank.number, -10_000n, -10_000n],
    [cash.number, -25_000n, -35_000n],
    [cash.number, 25_000n, -10_000n],
  ]);
  expect(statement.closingPaise).toBe(-10_000n);

  const fromSecond = await api.party.statement({
    orgSlug: organization.slug,
    partyId: buyer.id,
    from: "2026-09-02",
  });

  expect(fromSecond.openingPaise).toBe(-10_000n);
});
