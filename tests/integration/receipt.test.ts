import { beforeAll, expect, test } from "bun:test";
import { inflateRawSync } from "node:zlib";

import type { AppRouterClient } from "@accly/api/routers/index";
import { db } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { auditLog } from "@accly/db/schema/audit";
import { balances } from "@accly/db/schema/balances";
import { documentLines } from "@accly/db/schema/document-lines";
import { documents } from "@accly/db/schema/documents";
import { journalEntries } from "@accly/db/schema/journal-entries";
import { journalLines } from "@accly/db/schema/journal-lines";
import { partyLedgerLines } from "@accly/db/schema/party-ledger-lines";
import { paymentMethods } from "@accly/db/schema/payment-methods";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";

import {
  createAccountingOrganization,
  createFounderSession,
  createTestUser,
  joinOrganization,
  type TestUser,
} from "../support/auth";
import { clientFor, eventually, expectORPCCode } from "../support/client";
import { resetTestDatabase } from "../support/database";
import { uniqueSuffix } from "../support/unique";

type ReceiptDetail = typeof documents.$inferSelect & {
  paymentMethodName: string;
  lines: Array<typeof documentLines.$inferSelect>;
};

type ReceiptPostInput = Parameters<AppRouterClient["receipt"]["post"]>[0];

type Account = typeof accounts.$inferSelect;

type PaymentMethod = typeof paymentMethods.$inferSelect;

let founder: TestUser;

let accountant: TestUser;

let organization: { id: string; slug: string };

let api: AppRouterClient;

let party: { id: string; updatedAt: Date };

let customerAdvances: Account;

let bankAccount: Account;

let cashAccount: Account;

let exemptIncome: Account;

let taxableIncome: Account;

let bankTransfer: PaymentMethod;

let cashMethod: PaymentMethod;

let primaryReceipt: ReceiptDetail;

let primaryPostEntry: typeof journalEntries.$inferSelect;

let originalLegalName: string;

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing fixture: ${label}`);

  return value;
}

async function expectReason(promise: Promise<unknown>, reason: string, code = "BAD_REQUEST") {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof ORPCError)) throw error;
    expect(error.code).toBe(code);
    expect(error.data).toMatchObject({ reason });

    return;
  }

  throw new Error(`Expected ${code} with reason ${reason}`);
}

function readZipEntry(bytes: Uint8Array, name: string): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.length - 22;

  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--;

  if (eocd < 0) throw new Error("ZIP end-of-central-directory record not found");

  let cursor = view.getUint32(eocd + 16, true);
  const entries = view.getUint16(eocd + 10, true);

  for (let index = 0; index < entries; index++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("Invalid ZIP directory");
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);

    const entryName = new TextDecoder().decode(
      bytes.subarray(cursor + 46, cursor + 46 + nameLength),
    );

    if (entryName === name) {
      const localOffset = view.getUint32(cursor + 42, true);
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressedSize = view.getUint32(cursor + 20, true);
      const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
      const method = view.getUint16(cursor + 10, true);

      if (method === 0) return compressed;

      if (method === 8) return inflateRawSync(compressed);
      throw new Error(`Unsupported ZIP compression method ${method}`);
    }

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error(`ZIP entry not found: ${name}`);
}

beforeAll(async () => {
  await resetTestDatabase();
  founder = await createFounderSession();
  organization = await createAccountingOrganization(founder.headers, {
    slug: `receipt-${uniqueSuffix()}`,
    timeZone: "UTC",
  });
  accountant = await createTestUser(`receipt-accountant-${uniqueSuffix()}`);
  await joinOrganization(accountant, organization.id, "accountant");
  api = clientFor(accountant);

  const seededAccounts = await db
    .select()
    .from(accounts)
    .where(eq(accounts.orgId, organization.id));

  customerAdvances = required(
    seededAccounts.find(({ systemKey }) => systemKey === "customerAdvances"),
    "customer advances account",
  );
  bankAccount = required(
    seededAccounts.find(({ systemKey }) => systemKey === "bank"),
    "bank account",
  );
  cashAccount = required(
    seededAccounts.find(({ systemKey }) => systemKey === "cash"),
    "cash account",
  );
  exemptIncome = required(
    seededAccounts.find(({ type, supplyClass }) => type === "income" && supplyClass === "exempt"),
    "exempt income account",
  );
  taxableIncome = required(
    seededAccounts.find(({ type, supplyClass }) => type === "income" && supplyClass === "taxable"),
    "taxable income account",
  );

  const methods = await api.paymentMethod.list({ orgSlug: organization.slug });
  bankTransfer = required(
    methods.find(({ name }) => name === "Bank transfer"),
    "bank transfer payment method",
  );
  cashMethod = required(
    methods.find(({ name }) => name === "Cash"),
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

  primaryReceipt = await api.receipt.post({
    orgSlug: organization.slug,
    settlementKind: "advance",
    advanceSupply: "exempt",
    partyId: party.id,
    amount: "1250.50",
    paymentMethodId: bankTransfer.id,
    reference: "UTR1",
    documentDate: "2026-09-12",
  });

  const entries = await db
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.orgId, organization.id),
        eq(journalEntries.documentId, primaryReceipt.id),
        eq(journalEntries.kind, "post"),
      ),
    );

  primaryPostEntry = required(entries[0], "advance post entry");
});

test("accounting organization exposes its four seeded payment methods and receipt accounts", async () => {
  const methods = await api.paymentMethod.list({ orgSlug: organization.slug });
  expect(methods).toHaveLength(4);
  expect(methods.map(({ name }) => name)).toEqual(
    expect.arrayContaining(["Cash", "UPI", "Card", "Bank transfer"]),
  );
  expect(bankTransfer.accountId).toBe(bankAccount.id);
  expect(cashMethod.accountId).toBe(cashAccount.id);
  expect(customerAdvances.type).toBe("liability");
  expect((await api.organization.getProfile({ orgSlug: organization.slug })).gstin).toBeNull();
});

test("advance receipt posts to customer advances, updates balances, numbers, and audit", async () => {
  expect(primaryReceipt).toMatchObject({
    state: "posted",
    number: "RCT2026-27/1",
    totalPaise: 125_050n,
    paymentMethodName: "Bank transfer",
  });
  expect(typeof primaryReceipt.totalPaise).toBe("bigint");
  expect(primaryReceipt.printSnapshot?.party?.name).toBe("Receipt Customer");
  expect(primaryReceipt.lines).toEqual([
    expect.objectContaining({
      kind: "account",
      accountId: null,
      description: "Advance received",
      amountPaise: 125_050n,
    }),
  ]);

  expect(primaryPostEntry.documentType).toBe("receipt");

  const lines = await db
    .select()
    .from(journalLines)
    .where(
      and(eq(journalLines.orgId, organization.id), eq(journalLines.entryId, primaryPostEntry.id)),
    );

  expect(lines).toHaveLength(2);
  expect(lines).toEqual(
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

  const ledger = await db
    .select()
    .from(partyLedgerLines)
    .where(
      and(
        eq(partyLedgerLines.orgId, organization.id),
        eq(partyLedgerLines.documentId, primaryReceipt.id),
      ),
    );

  expect(ledger).toEqual([
    expect.objectContaining({
      partyId: party.id,
      side: "receivable",
      kind: "post",
      amountPaise: -125_050n,
    }),
  ]);

  const monthlyBalances = await db
    .select()
    .from(balances)
    .where(and(eq(balances.orgId, organization.id), eq(balances.month, "2026-09-01")));

  expect(monthlyBalances).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ accountId: bankAccount.id, debit: 125_050n, credit: 0n }),
      expect.objectContaining({ accountId: customerAdvances.id, debit: 0n, credit: 125_050n }),
    ]),
  );

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

  expect(second.number).toBe("RCT2026-27/2");
});

test("direct receipt credits exempt income without creating party exposure", async () => {
  const receipt = await api.receipt.post({
    orgSlug: organization.slug,
    settlementKind: "direct",
    amount: "75.25",
    paymentMethodId: cashMethod.id,
    incomeAccountId: exemptIncome.id,
    narration: "Interest received",
    documentDate: "2026-09-12",
  });

  expect(receipt.affectsTax).toBe(false);
  expect(receipt.printSnapshot?.party).toBeNull();
  expect(receipt.lines).toEqual([
    expect.objectContaining({ accountId: exemptIncome.id, description: "Interest received" }),
  ]);

  const [entry] = await db
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.orgId, organization.id),
        eq(journalEntries.documentId, receipt.id),
        eq(journalEntries.kind, "post"),
      ),
    );

  const lines = await db
    .select()
    .from(journalLines)
    .where(
      and(
        eq(journalLines.orgId, organization.id),
        eq(journalLines.entryId, required(entry, "direct entry").id),
      ),
    );

  expect(lines).toContainEqual(
    expect.objectContaining({ accountId: exemptIncome.id, debit: 0n, credit: 7_525n }),
  );
  expect(
    await db
      .select()
      .from(partyLedgerLines)
      .where(
        and(
          eq(partyLedgerLines.orgId, organization.id),
          eq(partyLedgerLines.documentId, receipt.id),
        ),
      ),
  ).toHaveLength(0);
});

test("receipt post rejects invalid settlements and enforces advance supply policy", async () => {
  const directInput: ReceiptPostInput = {
    orgSlug: organization.slug,
    settlementKind: "direct",
    amount: "10.00",
    paymentMethodId: cashMethod.id,
    incomeAccountId: exemptIncome.id,
  };

  // The server derives the exposure side, and `against` has no input shape until slice 4.
  for (const payload of [
    { ...directInput, exposureSide: "receivable" },
    { ...directInput, settlementKind: "against" },
  ]) {
    // SAFETY: A deliberately malformed wire payload proves strict union validation.
    await expectORPCCode(api.receipt.post(payload as unknown as ReceiptPostInput), "BAD_REQUEST");
  }

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

  const goodsAdvance = await gstApi.receipt.post({
    ...gstAdvance,
    advanceSupply: "goods",
  });

  expect(goodsAdvance.state).toBe("posted");
  expect(goodsAdvance.advanceSupply).toBe("goods");
});

test("cancelling reverses stored lines once even after payment method remapping", async () => {
  await db
    .update(paymentMethods)
    .set({ accountId: cashAccount.id, updatedAt: new Date() })
    .where(and(eq(paymentMethods.orgId, organization.id), eq(paymentMethods.id, bankTransfer.id)));

  const cancelled = await api.receipt.cancel({
    orgSlug: organization.slug,
    receiptId: primaryReceipt.id,
    reason: "entered twice",
  });

  expect(cancelled.state).toBe("cancelled");

  const [reverseEntry] = await db
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.orgId, organization.id),
        eq(journalEntries.documentId, primaryReceipt.id),
        eq(journalEntries.kind, "reverse"),
      ),
    );

  expect(reverseEntry?.reversesEntryId).toBe(primaryPostEntry.id);

  const reverseLines = await db
    .select()
    .from(journalLines)
    .where(
      and(
        eq(journalLines.orgId, organization.id),
        eq(journalLines.entryId, required(reverseEntry, "reverse entry").id),
      ),
    );

  expect(reverseLines).toEqual(
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
  expect(reverseLines.some(({ accountId }) => accountId === cashAccount.id)).toBe(false);

  const ledger = await db
    .select()
    .from(partyLedgerLines)
    .where(
      and(
        eq(partyLedgerLines.orgId, organization.id),
        eq(partyLedgerLines.documentId, primaryReceipt.id),
      ),
    );

  expect(ledger).toContainEqual(
    expect.objectContaining({ kind: "reverse", amountPaise: 125_050n }),
  );

  const reversedBalances = await db
    .select()
    .from(balances)
    .where(and(eq(balances.orgId, organization.id), eq(balances.month, "2026-09-01")));

  for (const accountId of [bankAccount.id, customerAdvances.id]) {
    const balance = required(
      reversedBalances.find((row) => row.accountId === accountId),
      `reversed balance ${accountId}`,
    );

    expect(balance.debit - balance.credit).toBe(0n);
  }

  await expectReason(
    api.receipt.cancel({
      orgSlug: organization.slug,
      receiptId: primaryReceipt.id,
      reason: "again",
    }),
    "ALREADY_CANCELLED",
    "CONFLICT",
  );

  await db
    .update(paymentMethods)
    .set({ accountId: bankAccount.id, updatedAt: new Date() })
    .where(and(eq(paymentMethods.orgId, organization.id), eq(paymentMethods.id, bankTransfer.id)));
});

test("receipt detail preserves the posted party and organization print snapshot", async () => {
  await api.party.update({
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

  const reprint = await api.receipt.get({
    orgSlug: organization.slug,
    receiptId: primaryReceipt.id,
  });

  expect(reprint.printSnapshot?.party?.name).toBe("Receipt Customer");
  expect(reprint.printSnapshot?.organization.legalName).toBe(originalLegalName);
  expect(reprint.paymentMethodName).toBe("Renamed method");
  expect(reprint.printSnapshot?.paymentMethod).toBe("Bank transfer");
  expect(reprint.printSnapshot?.lines).toEqual([
    { description: expect.any(String), hsnSac: null, unit: null },
  ]);
  await db
    .update(paymentMethods)
    .set({ name: bankTransfer.name })
    .where(and(eq(paymentMethods.orgId, organization.id), eq(paymentMethods.id, bankTransfer.id)));
});

test("payment methods settle only into cash or bank accounts", async () => {
  await expectReason(
    api.paymentMethod.create({
      orgSlug: organization.slug,
      name: "Receivables as cash",
      accountId: customerAdvances.id,
    }),
    "ACCOUNT_NOT_CASH_OR_BANK",
  );

  const created = await api.paymentMethod.create({
    orgSlug: organization.slug,
    name: "Second till",
    accountId: cashAccount.id,
  });

  expect(created.accountId).toBe(cashAccount.id);
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
  const sharedStrings = new TextDecoder().decode(readZipEntry(bytes, "xl/sharedStrings.xml"));
  const sheet = new TextDecoder().decode(readZipEntry(bytes, "xl/worksheets/sheet1.xml"));
  expect(sharedStrings).toContain("RCT2026-27/1");
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

  const ids = async (filters: Partial<Parameters<AppRouterClient["receipt"]["list"]>[0]>) =>
    (
      await api.receipt.list({ orgSlug: organization.slug, partyId: buyer.id, ...filters })
    ).rows.map(({ id }) => id);

  expect(await ids({})).toEqual([direct.id, cash.id, bank.id]);
  expect(await ids({ paymentMethodIds: [cashMethod.id] })).toEqual([cash.id]);
  expect(await ids({ state: "cancelled" })).toEqual([cash.id]);
  expect(await ids({ settlementKind: "direct" })).toEqual([direct.id]);
  expect(await ids({ from: "2026-09-02", to: "2026-09-09" })).toEqual([cash.id]);

  await expectORPCCode(
    api.receipt.list({ orgSlug: organization.slug, from: "2026-09-10", to: "2026-09-01" }),
    "BAD_REQUEST",
  );

  const totals = await api.receipt.partyTotals({ orgSlug: organization.slug });

  expect(totals.find((row) => row.partyId === buyer.id)).toEqual({
    partyId: buyer.id,
    receiptCount: 2,
    receivedPaise: 14_000n,
    lastReceiptDate: "2026-09-10",
  });

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
