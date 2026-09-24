import { beforeAll, expect, test } from "bun:test";

import type { AppRouterClient } from "@accly/api/routers/index";
import { financialYearOf } from "@accly/api/core/numbering";
import { db } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { auditLog } from "@accly/db/schema/audit";
import { documentLines } from "@accly/db/schema/document-lines";
import { paymentMethods } from "@accly/db/schema/payment-methods";
import { numberSeries } from "@accly/db/schema/number-series";
import { SETTINGS_DEFAULTS } from "@accly/db/schema/organization-settings";
import { tdsSections } from "@accly/db/schema/tds-sections";
import { and, eq, sql } from "drizzle-orm";

import { createAccountingFixture, postingOf } from "../support/accounting";
import { required } from "../support/assert";
import { createFounderSession, type TestUser } from "../support/auth";
import { eventually, expectReason } from "../support/client";
import { resetTestDatabase } from "../support/database";
import { readZipText } from "../support/xlsx";

type PaymentDetail = Awaited<ReturnType<AppRouterClient["payment"]["get"]>>;

type PaymentPostInput = Parameters<AppRouterClient["payment"]["post"]>[0];

type Account = typeof accounts.$inferSelect;

type PaymentMethod = typeof paymentMethods.$inferSelect;

let founder: TestUser;

let organization: { id: string; slug: string };

let api: AppRouterClient;

let foreignOrganization: { id: string; slug: string };

let foreignApi: AppRouterClient;

let vendor: { id: string };

let supplierAdvances: Account;

let tdsPayable: Account;

let bankAccount: Account;

let expenseAccount: Account;

let bankTransfer: PaymentMethod;

let section1024: typeof tdsSections.$inferSelect;

let expiredSectionId: string;

let primaryPayment: PaymentDetail;

let primaryPosting: Awaited<ReturnType<typeof postingOf>>;

async function registerText(orgApi: AppRouterClient, orgSlug: string, from: string, to: string) {
  const file = await orgApi.export.tdsRegisterXlsx({ orgSlug, from, to });

  return readZipText(new Uint8Array(await file.arrayBuffer()), "xl/sharedStrings.xml");
}

async function blockedPid(blockerPid: number): Promise<number> {
  return eventually(async () => {
    const { rows } = await db.execute<{ pid: number }>(
      sql`select waiter.pid::int as pid
          from pg_stat_activity waiter
          where ${blockerPid} = any(pg_blocking_pids(waiter.pid))
          limit 1`,
    );

    return rows[0]?.pid;
  }, 5_000);
}

beforeAll(async () => {
  await resetTestDatabase();
  founder = await createFounderSession();

  const own = await createAccountingFixture(founder, "payment");
  const foreign = await createAccountingFixture(founder, "payment-foreign");
  organization = own.organization;
  api = own.api;
  foreignOrganization = foreign.organization;
  foreignApi = foreign.api;

  supplierAdvances = required(
    own.accounts.find(({ systemKey }) => systemKey === "supplierAdvances"),
    "supplier advances account",
  );
  tdsPayable = required(
    own.accounts.find(({ systemKey }) => systemKey === "tdsPayable"),
    "TDS payable account",
  );
  bankAccount = required(
    own.accounts.find(({ code }) => code === "1101"),
    "bank account",
  );
  expenseAccount = required(
    own.accounts.find(({ type, systemKey }) => type === "expense" && systemKey === null),
    "expense account",
  );
  bankTransfer = required(
    own.methods.find(({ name }) => name === "Bank transfer"),
    "bank transfer payment method",
  );
  vendor = await api.party.create({
    orgSlug: organization.slug,
    name: "Payment Vendor",
    roles: ["vendor"],
    pan: "ABCDE1234F",
    stateCode: "27",
    addressLine1: "3 Vendor Road",
    city: "Pune",
    pinCode: "411001",
  });

  section1024 = required(
    (await db.select().from(tdsSections).where(eq(tdsSections.orgId, organization.id))).find(
      ({ code }) => code === "1024",
    ),
    "1024 contractor TDS section",
  );
  expiredSectionId = Bun.randomUUIDv7();
  await db.insert(tdsSections).values({
    id: expiredSectionId,
    orgId: organization.id,
    code: "1024",
    description: "Expired contractor row",
    rateBasisPoints: 100,
    effectiveFrom: "2025-04-01",
    effectiveTo: "2026-03-31",
  });

  const posted = await api.payment.post({
    orgSlug: organization.slug,
    settlementKind: "advance",
    partyId: vendor.id,
    amount: "1000.00",
    paymentMethodId: bankTransfer.id,
    tdsSectionId: section1024.id,
    reference: "PAY-UTR-1",
    documentDate: "2026-09-12",
  });

  primaryPayment = await api.payment.get({ orgSlug: organization.slug, paymentId: posted.id });
  primaryPosting = await postingOf(organization.id, primaryPayment.id, "post");
});

test("TDS sections return effective rows and omit expired rows", async () => {
  const sections = await api.payment.tdsSections({
    orgSlug: organization.slug,
    date: "2026-09-12",
  });

  expect(sections).toContainEqual(expect.objectContaining({ code: "1024", rateBasisPoints: 200 }));
  expect(sections.some(({ id }) => id === expiredSectionId)).toBe(false);
});

test("advance payment deducts TDS and posts payable exposure", async () => {
  expect(primaryPayment).toMatchObject({
    state: "posted",
    type: "payment",
    totalPaise: 100_000n,
    tds: {
      code: "1024",
      description: expect.any(String),
      rateBasisPoints: 200,
      amountPaise: 2_000n,
    },
  });
  expect(primaryPayment.number).toMatch(/^PMT/);
  expect(
    await db
      .select()
      .from(documentLines)
      .where(
        and(
          eq(documentLines.orgId, organization.id),
          eq(documentLines.documentId, primaryPayment.id),
        ),
      ),
  ).toEqual([
    expect.objectContaining({
      accountId: null,
      description: "Advance paid",
      amountPaise: 100_000n,
    }),
  ]);

  expect(primaryPosting.lines).toHaveLength(3);
  expect(primaryPosting.lines).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        accountId: supplierAdvances.id,
        partyId: vendor.id,
        debit: 100_000n,
        credit: 0n,
      }),
      expect.objectContaining({
        accountId: bankAccount.id,
        partyId: null,
        debit: 0n,
        credit: 98_000n,
      }),
      expect.objectContaining({
        accountId: tdsPayable.id,
        partyId: vendor.id,
        debit: 0n,
        credit: 2_000n,
      }),
    ]),
  );
  expect(primaryPosting.ledger).toEqual([
    expect.objectContaining({
      partyId: vendor.id,
      side: "payable",
      kind: "post",
      amountPaise: 100_000n,
    }),
  ]);

  const auditEntry = await eventually(async () => {
    const rows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.orgId, organization.id), eq(auditLog.action, "payment.post")));

    return rows.find(({ target }) => target === `payment:${primaryPayment.id}`);
  });

  expect(auditEntry.meta).toMatchObject({
    amount: "1000.00",
    settlementKind: "advance",
    tds: "20.00",
    code: "1024",
  });

  const listed = await api.payment.list({ orgSlug: organization.slug, q: "PAY-UTR-1" });
  expect(listed.rows).toContainEqual(expect.objectContaining({ id: primaryPayment.id }));
});

test("direct payments post without exposure and reject invalid accounts or TDS", async () => {
  const direct = await api.payment.post({
    orgSlug: organization.slug,
    settlementKind: "direct",
    amount: "75.25",
    paymentMethodId: bankTransfer.id,
    expenseAccountId: expenseAccount.id,
    narration: "Office supplies",
    documentDate: "2026-09-12",
  });

  expect(
    (await api.payment.get({ orgSlug: organization.slug, paymentId: direct.id })).tds,
  ).toBeNull();

  const posting = await postingOf(organization.id, direct.id, "post");

  expect(posting.lines).toHaveLength(2);
  expect(posting.lines).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ accountId: expenseAccount.id, debit: 7_525n, credit: 0n }),
      expect.objectContaining({ accountId: bankAccount.id, debit: 0n, credit: 7_525n }),
    ]),
  );
  expect(posting.ledger).toHaveLength(0);

  const validDirect: PaymentPostInput = {
    orgSlug: organization.slug,
    settlementKind: "direct",
    amount: "100.00",
    paymentMethodId: bankTransfer.id,
    expenseAccountId: expenseAccount.id,
    documentDate: "2026-09-12",
  };

  await expectReason(
    api.payment.post({ ...validDirect, tdsSectionId: section1024.id }),
    "TDS_PARTY_REQUIRED",
  );
  await expectReason(
    api.payment.post({ ...validDirect, partyId: vendor.id, tdsSectionId: expiredSectionId }),
    "TDS_SECTION_INVALID",
  );

  const noPanVendor = await api.party.create({
    orgSlug: organization.slug,
    name: "Vendor Without PAN",
    roles: ["vendor"],
    stateCode: "27",
  });

  await expectReason(
    api.payment.post({ ...validDirect, partyId: noPanVendor.id, tdsSectionId: section1024.id }),
    "TDS_PAN_REQUIRED",
  );

  const foreignSection = required(
    (await db.select().from(tdsSections).where(eq(tdsSections.orgId, foreignOrganization.id)))[0],
    "foreign TDS section",
  );

  await expectReason(
    api.payment.post({ ...validDirect, partyId: vendor.id, tdsSectionId: foreignSection.id }),
    "TDS_SECTION_INVALID",
  );

  // Money moves between money accounts only by the slice 5 Journal.
  await expectReason(
    api.payment.post({ ...validDirect, expenseAccountId: bankAccount.id }),
    "EXPENSE_ACCOUNT_INVALID",
  );

  const directWithTds = await api.payment.post({
    ...validDirect,
    partyId: vendor.id,
    tdsSectionId: section1024.id,
  });

  const directWithTdsDetail = await api.payment.get({
    orgSlug: organization.slug,
    paymentId: directWithTds.id,
  });

  expect(directWithTdsDetail.tds).toMatchObject({ code: "1024", amountPaise: 200n });
  expect((await postingOf(organization.id, directWithTds.id, "post")).lines).toHaveLength(3);
});

test("posting refuses an archived party", async () => {
  const archivedVendor = await api.party.create({
    orgSlug: organization.slug,
    name: "Archived Payment Vendor",
    roles: ["vendor"],
    stateCode: "27",
  });

  await api.party.update({
    orgSlug: organization.slug,
    partyId: archivedVendor.id,
    name: archivedVendor.name,
    roles: archivedVendor.roles,
    stateCode: archivedVendor.stateCode,
    active: false,
    updatedAt: archivedVendor.updatedAt.toISOString(),
  });

  await expectReason(
    api.payment.post({
      orgSlug: organization.slug,
      settlementKind: "advance",
      partyId: archivedVendor.id,
      amount: "100.00",
      paymentMethodId: bankTransfer.id,
      documentDate: "2026-09-12",
    }),
    "PARTY_INVALID",
  );
});

test("posting holds its validated party until a competing archive can serialize", async () => {
  const documentDate = "2026-09-12";
  const paymentFinancialYear = financialYearOf(documentDate, SETTINGS_DEFAULTS.financialYearStart);
  const paymentPrefix = SETTINGS_DEFAULTS.paymentPrefix;

  const concurrentVendor = await api.party.create({
    orgSlug: organization.slug,
    name: "Concurrent Payment Vendor",
    roles: ["vendor"],
    stateCode: "27",
  });

  await db.insert(numberSeries).values({
    orgId: organization.id,
    documentType: "payment",
    financialYear: paymentFinancialYear,
    prefix: "IRRELEVANT",
    next: 1,
  });

  const gateReady = Promise.withResolvers<number>();
  const releaseGate = Promise.withResolvers<void>();

  const gate = db.transaction(async (tx) => {
    const { rows } = await tx.execute<{ pid: number }>(sql`select pg_backend_pid()::int as pid`);
    const holderPid = required(rows[0]?.pid, "series lock holder pid");

    const [series] = await tx
      .select({ next: numberSeries.next })
      .from(numberSeries)
      .where(
        and(
          eq(numberSeries.orgId, organization.id),
          eq(numberSeries.documentType, "payment"),
          eq(numberSeries.financialYear, paymentFinancialYear),
          eq(numberSeries.prefix, paymentPrefix),
        ),
      )
      .for("update");

    required(series, "payment number series");
    gateReady.resolve(holderPid);
    await releaseGate.promise;
  });

  void gate.catch(gateReady.reject);
  const holderPid = await gateReady.promise;

  const posting = api.payment.post({
    orgSlug: organization.slug,
    settlementKind: "advance",
    partyId: concurrentVendor.id,
    amount: "100.00",
    paymentMethodId: bankTransfer.id,
    documentDate,
  });

  const postingFinished = Promise.allSettled([posting]);
  let archiveFinished: Promise<unknown> = Promise.resolve();
  let archiving: Promise<typeof concurrentVendor> | undefined;

  try {
    const postingPid = await blockedPid(holderPid);
    archiving = api.party.update({
      orgSlug: organization.slug,
      partyId: concurrentVendor.id,
      name: concurrentVendor.name,
      roles: concurrentVendor.roles,
      stateCode: concurrentVendor.stateCode,
      active: false,
      updatedAt: concurrentVendor.updatedAt.toISOString(),
    });
    archiveFinished = Promise.allSettled([archiving]);
    await blockedPid(postingPid);
  } finally {
    releaseGate.resolve();
    await Promise.allSettled([postingFinished, archiveFinished, gate]);
  }

  const [posted, archived] = await Promise.all([
    posting,
    required(archiving, "competing party archive"),
    gate,
  ]);

  const stored = await api.payment.get({
    orgSlug: organization.slug,
    paymentId: posted.id,
  });

  expect(archived.active).toBe(false);
  expect(stored).toMatchObject({
    state: "posted",
    partyId: concurrentVendor.id,
    printSnapshot: { party: { name: concurrentVendor.name } },
  });
}, 15_000);

test("cancelling reverses TDS once and removes the deduction from the register", async () => {
  expect(await registerText(api, organization.slug, "2026-09-12", "2026-09-12")).toContain(
    required(primaryPayment.number, "primary payment number"),
  );

  const cancelled = await api.payment.cancel({
    orgSlug: organization.slug,
    paymentId: primaryPayment.id,
    reason: "entered twice",
  });

  expect(cancelled.state).toBe("cancelled");
  // The deduction row stays; the register drops it because the Payment is cancelled.
  expect(
    (await api.payment.get({ orgSlug: organization.slug, paymentId: primaryPayment.id })).tds,
  ).toMatchObject({ code: "1024", rateBasisPoints: 200, amountPaise: 2_000n });

  const reversal = await postingOf(organization.id, primaryPayment.id, "reverse");

  expect(reversal.entry.reversesEntryId).toBe(primaryPosting.entry.id);
  expect(reversal.ledger).toContainEqual(
    expect.objectContaining({ side: "payable", kind: "reverse", amountPaise: -100_000n }),
  );

  expect(await registerText(api, organization.slug, "2026-09-12", "2026-09-12")).not.toContain(
    required(primaryPayment.number, "primary payment number"),
  );

  await expect(
    api.payment.cancel({
      orgSlug: organization.slug,
      paymentId: primaryPayment.id,
      reason: "again",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

test("a receipt cancel cannot cancel a payment", async () => {
  const payment = await api.payment.post({
    orgSlug: organization.slug,
    settlementKind: "direct",
    amount: "50.00",
    paymentMethodId: bankTransfer.id,
    expenseAccountId: expenseAccount.id,
    documentDate: "2026-09-14",
  });

  await expect(
    api.receipt.cancel({
      orgSlug: organization.slug,
      receiptId: payment.id,
      reason: "wrong document type",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });

  expect(
    await api.payment.get({ orgSlug: organization.slug, paymentId: payment.id }),
  ).toMatchObject({ state: "posted" });
});

test("a section whose deduction rounds to zero is still recorded", async () => {
  const section1031 = required(
    (await api.payment.tdsSections({ orgSlug: organization.slug, date: "2026-09-15" })).find(
      ({ code }) => code === "1031",
    ),
    "1031 goods TDS section",
  );

  const payment = await api.payment.post({
    orgSlug: organization.slug,
    settlementKind: "advance",
    partyId: vendor.id,
    amount: "1.00",
    paymentMethodId: bankTransfer.id,
    tdsSectionId: section1031.id,
    documentDate: "2026-09-15",
  });

  expect(
    (await api.payment.get({ orgSlug: organization.slug, paymentId: payment.id })).tds,
  ).toMatchObject({
    code: "1031",
    description: expect.any(String),
    rateBasisPoints: 10,
    amountPaise: 0n,
  });

  expect(await registerText(api, organization.slug, "2026-09-15", "2026-09-15")).toContain(
    required(payment.number, "zero TDS payment number"),
  );
});

test("payments are invisible across organizations", async () => {
  const payment = await api.payment.post({
    orgSlug: organization.slug,
    settlementKind: "advance",
    partyId: vendor.id,
    amount: "500.00",
    paymentMethodId: bankTransfer.id,
    tdsSectionId: section1024.id,
    documentDate: "2026-09-16",
  });

  await expect(
    foreignApi.payment.get({
      orgSlug: foreignOrganization.slug,
      paymentId: payment.id,
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });

  const foreignList = await foreignApi.payment.list({ orgSlug: foreignOrganization.slug });
  expect(foreignList.rows.some(({ id }) => id === payment.id)).toBe(false);

  await expect(
    foreignApi.payment.cancel({
      orgSlug: foreignOrganization.slug,
      paymentId: payment.id,
      reason: "foreign payment",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await api.payment.get({ orgSlug: organization.slug, paymentId: payment.id }),
  ).toMatchObject({ state: "posted" });

  // Only the org predicate guards this update by primary key.
  await expect(
    foreignApi.paymentMethod.setActive({
      orgSlug: foreignOrganization.slug,
      paymentMethodId: bankTransfer.id,
      active: false,
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(
    (await api.paymentMethod.list({ orgSlug: organization.slug })).find(
      ({ id }) => id === bankTransfer.id,
    )?.active,
  ).toBe(true);

  // The own-org register lists it, so the foreign exclusion below is the tenant
  // filter and not an empty register.
  expect(await registerText(api, organization.slug, "2026-09-16", "2026-09-16")).toContain(
    required(payment.number, "own organization payment number"),
  );
  expect(
    await registerText(foreignApi, foreignOrganization.slug, "2026-09-16", "2026-09-16"),
  ).not.toContain(required(payment.number, "foreign organization payment number"));
});

test("TDS register XLSX contains section and gross, TDS, and net amounts", async () => {
  const exportPayment = await api.payment.post({
    orgSlug: organization.slug,
    settlementKind: "advance",
    partyId: vendor.id,
    amount: "1000.00",
    paymentMethodId: bankTransfer.id,
    tdsSectionId: section1024.id,
    documentDate: "2026-09-13",
  });

  const file = await api.export.tdsRegisterXlsx({
    orgSlug: organization.slug,
    from: "2026-09-13",
    to: "2026-09-13",
  });

  expect(file).toBeInstanceOf(Blob);
  expect(file.name).toBe("tds-register-2026-09-13-2026-09-13.xlsx");
  expect(file.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const bytes = new Uint8Array(await file.arrayBuffer());
  expect(new TextDecoder().decode(bytes.subarray(0, 2))).toBe("PK");
  const sharedStrings = readZipText(bytes, "xl/sharedStrings.xml");
  const sheet = readZipText(bytes, "xl/worksheets/sheet1.xml");
  expect(sharedStrings).toContain(required(exportPayment.number, "export payment number"));
  expect(sharedStrings).toContain("1024");
  expect(sharedStrings).toContain("Payment Vendor");
  expect(sharedStrings).toContain("ABCDE1234F");
  expect(sheet).toMatch(/<v>1000<\/v>/);
  expect(sheet).toMatch(/<v>20<\/v>/);
  expect(sheet).toMatch(/<v>980<\/v>/);
});
