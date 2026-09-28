import { expect, test } from "bun:test";

import { businessDate } from "@accly/api/lib/business-date";
import { accountLedger } from "@accly/api/routers/report";
import { db } from "@accly/db";
import { journalEntries } from "@accly/db/schema/journal-entries";
import { journalLines } from "@accly/db/schema/journal-lines";
import { and, eq, lte } from "drizzle-orm";

import { createAccountingFixture, postingOf } from "../support/accounting";
import { required } from "../support/assert";
import { createFounderSession, createTestUser, joinOrganization } from "../support/auth";
import { clientFor, expectORPCCode, expectReason } from "../support/client";
import { resetTestDatabase } from "../support/database";
import { readZipText } from "../support/xlsx";

await resetTestDatabase();

const founder = await createFounderSession();

const fixture = await createAccountingFixture(founder, "report-trial-balance", {
  legalType: "proprietorship",
});

const todayDate = new Date();

const today = todayDate.toISOString().slice(0, 10);

const aprilYear = todayDate.getUTCFullYear() - (todayDate.getUTCMonth() >= 3 ? 1 : 2);

const from = `${aprilYear}-04-01`;

const to = `${aprilYear}-04-30`;

const march31 = `${aprilYear}-03-31`;

const claimDates = { from, to };

test("accounting reports reconcile posted lines, cancellation dates, and statement exports", async () => {
  const { organization, api } = fixture;
  const claim = { orgSlug: organization.slug };

  const cash = required(
    fixture.accounts.find(({ code }) => code === "1001"),
    "Cash in Hand",
  );

  const capital = required(
    fixture.accounts.find(({ name, type }) => name === "Capital Account" && type === "equity"),
    "Capital Account",
  );

  const income = required(
    fixture.accounts.find(({ type, supplyClass }) => type === "income" && supplyClass === "exempt"),
    "exempt income",
  );

  const cashMethod = required(
    fixture.methods.find(({ name }) => name === "Cash"),
    "Cash method",
  );

  const discount = await api.account.create({
    ...claim,
    parent: { type: "expense" },
    name: "Sibling Discount",
  });

  await api.openingBalance.post({
    ...claim,
    documentDate: march31,
    lines: [
      { accountId: cash.id, side: "debit", amount: "50000.00" },
      { accountId: capital.id, side: "credit", amount: "50000.00" },
    ],
  });

  const priya = await api.party.create({
    ...claim,
    name: "Priya / Long-form Consulting Services",
    roles: ["customer"],
    gstin: "27ABCDE1234F1Z5",
    address: "42 Market Road, Mumbai",
    stateCode: "27",
  });

  const service = await api.item.create({
    ...claim,
    name: "Exempt service",
    unit: "service",
    unitPrice: "10000.00",
    incomeAccountId: income.id,
  });

  const invoice = await api.invoice.post({
    ...claim,
    partyId: priya.id,
    placeOfSupplyStateCode: "27",
    documentDate: `${aprilYear}-04-10`,
    lines: [{ kind: "item", itemId: service.id, quantity: 1 }],
  });

  const receipt = await api.receipt.post({
    ...claim,
    settlementKind: "against",
    partyId: priya.id,
    amount: "4000.00",
    paymentMethodId: cashMethod.id,
    documentDate: `${aprilYear}-04-12`,
    allocations: [{ documentId: invoice.id, amount: "4000.00" }],
  });

  const journal = await api.journal.post({
    ...claim,
    documentDate: `${aprilYear}-04-28`,
    narration: "Sibling discount",
    lines: [
      { accountId: discount.id, side: "debit", amount: "500.00" },
      { accountId: cash.id, side: "credit", amount: "500.00" },
    ],
  });

  await api.journal.cancel({ ...claim, journalId: journal.id, reason: "Reversed discount" });
  const reversal = await postingOf(organization.id, journal.id, "reverse");
  expect(reversal.entry.entryDate).toBe(today);

  const april = await api.report.trialBalance({ ...claim, ...claimDates });
  expect(april.header.range).toEqual(claimDates);
  expect(april.rows.find(({ accountId }) => accountId === cash.id)).toMatchObject({
    openingDebitPaise: 5_000_000n,
    openingCreditPaise: 0n,
    closingDebitPaise: 5_350_000n,
    closingCreditPaise: 0n,
    debitPaise: 400_000n,
    creditPaise: 50_000n,
  });
  expect(april.rows.find(({ accountId }) => accountId === discount.id)).toMatchObject({
    debitPaise: 50_000n,
    creditPaise: 0n,
  });
  const current = await api.report.trialBalance({ ...claim, from: today, to: today });
  expect(
    current.rows
      .filter(({ debitPaise, creditPaise }) => debitPaise !== 0n || creditPaise !== 0n)
      .map(({ accountId, debitPaise, creditPaise }) => ({ accountId, debitPaise, creditPaise })),
  ).toEqual([
    { accountId: cash.id, debitPaise: 50_000n, creditPaise: 0n },
    { accountId: discount.id, debitPaise: 0n, creditPaise: 50_000n },
  ]);

  for (const { report, start, through } of [
    { report: april, start: from, through: to },
    { report: current, start: today, through: today },
  ]) {
    const stored = await db
      .select({
        accountId: journalLines.accountId,
        entryDate: journalEntries.entryDate,
        debit: journalLines.debit,
        credit: journalLines.credit,
      })
      .from(journalLines)
      .innerJoin(
        journalEntries,
        and(eq(journalEntries.orgId, organization.id), eq(journalEntries.id, journalLines.entryId)),
      )
      .where(and(eq(journalLines.orgId, organization.id), lte(journalEntries.entryDate, through)));

    const balances = new Map<string, { opening: bigint; debit: bigint; credit: bigint }>();

    for (const line of stored) {
      const balance = balances.get(line.accountId) ?? { opening: 0n, debit: 0n, credit: 0n };

      if (line.entryDate < start) balance.opening += line.debit - line.credit;
      else {
        balance.debit += line.debit;
        balance.credit += line.credit;
      }

      balances.set(line.accountId, balance);
    }

    expect(new Set(report.rows.map(({ accountId }) => accountId))).toEqual(
      new Set(balances.keys()),
    );

    for (const row of report.rows) {
      const balance = required(balances.get(row.accountId), `${row.code} balance`);
      expect(row.openingDebitPaise - row.openingCreditPaise).toBe(balance.opening);
      expect(row.debitPaise).toBe(balance.debit);
      expect(row.creditPaise).toBe(balance.credit);
      expect(row.closingDebitPaise - row.closingCreditPaise).toBe(
        balance.opening + balance.debit - balance.credit,
      );
    }
  }

  const file = await api.export.trialBalanceXlsx({ ...claim, ...claimDates });
  const sheet = readZipText(new Uint8Array(await file.arrayBuffer()), "xl/worksheets/sheet1.xml");

  const totalsRow = required(
    [...sheet.matchAll(/<row\b[^>]*>[\s\S]*?<\/row>/g)].at(-1),
    "XLSX totals row",
  )[0];

  const values = ["D", "E", "F", "G", "H", "I"].map((column) => {
    const cell = required(
      totalsRow.match(new RegExp(`<c\\b[^>]*r="${column}\\d+"[^>]*>\\s*<v>([^<]+)</v>`)),
      `${column} totals cell`,
    );

    return Number(cell[1]);
  });

  expect(values).toEqual(
    [
      april.totals.openingDebitPaise,
      april.totals.openingCreditPaise,
      april.totals.debitPaise,
      april.totals.creditPaise,
      april.totals.closingDebitPaise,
      april.totals.closingCreditPaise,
    ].map((paise) => Number(paise) / 100),
  );

  const bank = required(
    fixture.accounts.find(({ code }) => code === "1101"),
    "Bank account",
  );

  const bankMethod = required(
    fixture.methods.find(({ name }) => name === "Bank transfer"),
    "Bank transfer method",
  );

  await api.payment.post({
    ...claim,
    settlementKind: "direct",
    amount: "3000.00",
    paymentMethodId: bankMethod.id,
    expenseAccountId: discount.id,
    documentDate: `${aprilYear}-04-20`,
  });

  const profit = await api.report.profitAndLoss({ ...claim, ...claimDates });
  expect(profit.header.range).toEqual(claimDates);
  expect(profit).toMatchObject({
    incomePaise: 1_000_000n,
    expensesPaise: 350_000n,
    netProfitPaise: 650_000n,
  });
  expect(profit.income).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ accountId: income.id, amountPaise: 1_000_000n }),
    ]),
  );
  expect(profit.expenses).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ accountId: discount.id, amountPaise: 350_000n }),
    ]),
  );

  const aprilSheet = await api.report.balanceSheet({ ...claim, asOf: to });
  expect(aprilSheet.currentYearProfitPaise).toBe(650_000n);
  expect(aprilSheet.earlierYearsProfitPaise).toBe(0n);
  expect(aprilSheet.assetsPaise).toBe(aprilSheet.liabilitiesPaise + aprilSheet.equityPaise);

  await api.journal.post({
    ...claim,
    documentDate: march31,
    narration: "Previous-year income",
    lines: [
      { accountId: bank.id, side: "debit", amount: "200.00" },
      { accountId: income.id, side: "credit", amount: "200.00" },
    ],
  });
  const withEarlierYear = await api.report.balanceSheet({ ...claim, asOf: to });
  expect(withEarlierYear.currentYearProfitPaise).toBe(650_000n);
  expect(withEarlierYear.earlierYearsProfitPaise).toBe(20_000n);
  expect(withEarlierYear.assetsPaise).toBe(
    withEarlierYear.liabilitiesPaise + withEarlierYear.equityPaise,
  );
  const yearEnd = `${aprilYear + 1}-03-31`;
  const fullYear = await api.report.profitAndLoss({ ...claim, from, to: yearEnd });
  const yearEndSheet = await api.report.balanceSheet({ ...claim, asOf: yearEnd });
  expect(fullYear.netProfitPaise).toBe(yearEndSheet.currentYearProfitPaise);

  const aprilLedger = await api.report.accountLedger({
    ...claim,
    accountId: cash.id,
    ...claimDates,
  });

  expect(aprilLedger.account).toMatchObject({ id: cash.id, name: "Cash in Hand" });
  expect(aprilLedger.openingPaise).toBe(5_000_000n);
  expect(aprilLedger.lines).toEqual([
    expect.objectContaining({
      documentId: receipt.id,
      documentType: "receipt",
      kind: "post",
      debitPaise: 400_000n,
      creditPaise: 0n,
      balancePaise: 5_400_000n,
    }),
    expect.objectContaining({
      documentId: journal.id,
      documentType: "journal",
      kind: "post",
      debitPaise: 0n,
      creditPaise: 50_000n,
      balancePaise: 5_350_000n,
    }),
  ]);
  expect(aprilLedger.closingPaise).toBe(5_350_000n);

  const reversalLedger = await api.report.accountLedger({
    ...claim,
    accountId: cash.id,
    from: today,
    to: today,
  });

  expect(reversalLedger.lines).toEqual([
    expect.objectContaining({
      entryId: reversal.entry.id,
      documentId: journal.id,
      kind: "reverse",
      narration: expect.stringMatching(/^Reversal of /),
      debitPaise: 50_000n,
      creditPaise: 0n,
      balancePaise: 5_400_000n,
    }),
  ]);
  const dayBook = await api.report.dayBook({ ...claim, from: today, to: today });

  const reversedJournal = required(
    dayBook.entries.find(({ entryId }) => entryId === reversal.entry.id),
    "reversed journal in day book",
  );

  expect(reversedJournal).toMatchObject({
    documentId: journal.id,
    kind: "reverse",
    narration: expect.stringMatching(/^Reversal of /),
  });
  expect(reversedJournal.lines).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ accountCode: cash.code, debitPaise: 50_000n, creditPaise: 0n }),
      expect.objectContaining({ accountCode: discount.code, debitPaise: 0n, creditPaise: 50_000n }),
    ]),
  );
  expect(dayBook.debitPaise).toBe(50_000n);
  expect(dayBook.creditPaise).toBe(50_000n);

  const journalThroughReversal = { accountId: cash.id, from: `${aprilYear}-04-28`, to: today };
  await expectReason(accountLedger(organization.id, journalThroughReversal, 1), "REPORT_TOO_LARGE");
  const boundedLedger = await accountLedger(organization.id, journalThroughReversal, 100);
  expect(boundedLedger.lines.map(({ entryId, kind }) => ({ entryId, kind }))).toEqual([
    { entryId: (await postingOf(organization.id, journal.id, "post")).entry.id, kind: "post" },
    { entryId: reversal.entry.id, kind: "reverse" },
  ]);

  const statement = await api.party.statement({ ...claim, partyId: priya.id, ...claimDates });
  expect(statement.header.range).toEqual(claimDates);
  expect(statement.party.name).toBe("Priya / Long-form Consulting Services");
  expect(statement.openingPaise).toBe(0n);
  expect(
    statement.lines.map(({ documentId, documentType, balancePaise }) => ({
      documentId,
      documentType,
      balancePaise,
    })),
  ).toEqual([
    { documentId: invoice.id, documentType: "invoice", balancePaise: 1_000_000n },
    { documentId: receipt.id, documentType: "receipt", balancePaise: 600_000n },
  ]);
  expect(statement.closingPaise).toBe(600_000n);

  const statementFile = await api.export.partyStatementXlsx({
    ...claim,
    partyId: priya.id,
    ...claimDates,
  });

  const statementBytes = new Uint8Array(await statementFile.arrayBuffer());
  const statementStrings = readZipText(statementBytes, "xl/sharedStrings.xml");
  const statementSheet = readZipText(statementBytes, "xl/worksheets/sheet1.xml");
  expect(statementStrings).toContain("Priya / Long-form Consulting Services");
  expect(statementStrings).toContain(required(statement.lines[0]?.number, "invoice number"));
  expect(statementStrings).toContain(required(statement.lines[1]?.number, "receipt number"));
  expect(statementStrings).toContain("27ABCDE1234F1Z5");
  expect(statementStrings).toContain("42 Market Road, Mumbai");
  expect(statementStrings).toContain("State code");
  expect(statementStrings).toContain(">27<");
  expect(statementSheet).toMatch(/<row\b[^>]*r="9"[^>]*>/);

  const closingRow = required(
    [...statementSheet.matchAll(/<row\b[^>]*>[\s\S]*?<\/row>/g)].at(-1),
    "statement XLSX closing row",
  )[0];

  expect(closingRow).toMatch(/<c\b[^>]*r="G\d+"[^>]*>\s*<v>6000<\/v>/);

  const foreign = await createAccountingFixture(founder, "report-foreign-party");

  const foreignParty = await foreign.api.party.create({
    orgSlug: foreign.organization.slug,
    name: "Foreign Party",
    roles: ["customer"],
    stateCode: "27",
  });

  await expectORPCCode(
    api.party.statement({ ...claim, partyId: foreignParty.id, ...claimDates }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    api.party.ledgerLines({ ...claim, partyId: foreignParty.id, ...claimDates }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    api.party.ledgerSummary({ ...claim, partyId: foreignParty.id, ...claimDates }),
    "NOT_FOUND",
  );

  const foreignAccount = required(
    foreign.accounts.find(({ code }) => code === "1001"),
    "foreign cash account",
  );

  await expectORPCCode(
    api.report.accountLedger({ ...claim, accountId: foreignAccount.id, ...claimDates }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    api.report.accountLedgerLines({ ...claim, accountId: foreignAccount.id, ...claimDates }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    api.report.accountLedgerSummary({ ...claim, accountId: foreignAccount.id, ...claimDates }),
    "NOT_FOUND",
  );

  const cashGroup = required(
    fixture.accounts.find(({ code }) => code === "1000"),
    "cash account group",
  );

  await expectReason(
    api.report.accountLedger({ ...claim, accountId: cashGroup.id, ...claimDates }),
    "ACCOUNT_INVALID",
  );
  await expectReason(
    api.report.accountLedgerSummary({ ...claim, accountId: cashGroup.id, ...claimDates }),
    "ACCOUNT_INVALID",
  );
});

test("ledger and day-book pages match the full reports without splitting entries", async () => {
  const { api, accounts, methods, organization } = await createAccountingFixture(
    founder,
    "paged-ledgers",
  );

  const claim = { orgSlug: organization.slug };

  const cash = required(
    accounts.find(({ code }) => code === "1001"),
    "cash",
  );

  const income = required(
    accounts.find(({ type, supplyClass }) => type === "income" && supplyClass === "exempt"),
    "income",
  );

  const cashMethod = required(
    methods.find(({ name }) => name === "Cash"),
    "cash method",
  );

  const party = await api.party.create({
    ...claim,
    name: "Paged customer",
    roles: ["customer"],
    stateCode: "27",
  });

  const item = await api.item.create({
    ...claim,
    name: "Paged service",
    unitPrice: "100.00",
    incomeAccountId: income.id,
  });

  await api.journal.post({
    ...claim,
    documentDate: from,
    narration: "Cash income",
    lines: [
      { accountId: cash.id, side: "debit", amount: "50.00" },
      { accountId: income.id, side: "credit", amount: "50.00" },
    ],
  });

  const invoice = await api.invoice.post({
    ...claim,
    partyId: party.id,
    placeOfSupplyStateCode: "27",
    documentDate: from,
    lines: [{ kind: "item", itemId: item.id, quantity: 1 }],
  });

  await api.receipt.post({
    ...claim,
    settlementKind: "against",
    partyId: party.id,
    amount: "40.00",
    paymentMethodId: cashMethod.id,
    documentDate: to,
    allocations: [{ documentId: invoice.id, amount: "40.00" }],
  });

  const accountInput = { ...claim, accountId: cash.id, ...claimDates };
  const accountRows = [];
  let accountCursor: { entryDate: string; id: string } | undefined;

  while (true) {
    const page = await api.report.accountLedgerLines({
      ...accountInput,
      limit: 1,
      cursor: accountCursor,
    });

    accountRows.push(...page.rows);

    if (!page.hasMore) break;
    const last = required(page.rows.at(-1), "account page line");
    accountCursor = { entryDate: last.entryDate, id: last.id };
  }

  const fullLedger = await api.report.accountLedger(accountInput);
  expect(accountRows.length).toBeGreaterThan(1);
  expect(accountRows.map(({ id, narration }) => [id, narration])).toEqual(
    fullLedger.lines.map(({ id, narration }) => [id, narration]),
  );
  const accountSummary = await api.report.accountLedgerSummary(accountInput);
  expect(accountSummary.openingPaise).toBe(fullLedger.openingPaise);
  expect(accountSummary.closingPaise).toBe(fullLedger.closingPaise);
  expect(accountSummary.closingPaise).toBe(
    accountRows.reduce(
      (balance, row) => balance + row.debitPaise - row.creditPaise,
      accountSummary.openingPaise,
    ),
  );

  const partyInput = { ...claim, partyId: party.id, ...claimDates };
  const partyRows = [];
  let partyCursor: { entryDate: string; id: string } | undefined;

  while (true) {
    const page = await api.party.ledgerLines({ ...partyInput, limit: 1, cursor: partyCursor });
    partyRows.push(...page.rows);

    if (!page.hasMore) break;
    const last = required(page.rows.at(-1), "party page line");
    partyCursor = { entryDate: last.entryDate, id: last.id };
  }

  const statement = await api.party.statement(partyInput);
  expect(partyRows.length).toBeGreaterThan(1);
  expect(partyRows.map(({ id }) => id)).toEqual(statement.lines.map(({ id }) => id));
  const partySummary = await api.party.ledgerSummary(partyInput);
  expect(partySummary.openingPaise).toBe(statement.openingPaise);
  expect(partySummary.closingPaise).toBe(statement.closingPaise);
  expect(partySummary.debitPaise - partySummary.creditPaise).toBe(
    partyRows.reduce((total, row) => total + row.amountPaise, 0n),
  );

  const bookInput = { ...claim, ...claimDates };
  const bookSummary = await api.report.dayBookSummary(bookInput);
  const entries = [];
  let cursor: { entryDate: string; id: string } | undefined;

  while (true) {
    const page = await api.report.dayBookEntries({ ...bookInput, limit: 1, cursor });
    entries.push(...page.rows);

    if (!page.hasMore) break;
    const last = required(page.rows.at(-1), "page entry");
    cursor = { entryDate: last.entryDate, id: last.entryId };
  }

  expect(new Set(entries.map(({ entryId }) => entryId)).size).toBe(entries.length);
  expect(entries.every(({ lines }) => lines.length >= 2)).toBe(true);
  expect(bookSummary.entryCount).toBe(entries.length);
  expect(bookSummary.debitPaise).toBe(
    entries.flatMap(({ lines }) => lines).reduce((total, line) => total + line.debitPaise, 0n),
  );
  expect(bookSummary.creditPaise).toBe(
    entries.flatMap(({ lines }) => lines).reduce((total, line) => total + line.creditPaise, 0n),
  );
  expect(bookSummary.debitPaise).toBe(bookSummary.creditPaise);

  const cancelledInvoice = await api.invoice.post({
    ...claim,
    partyId: party.id,
    placeOfSupplyStateCode: "27",
    documentDate: from,
    lines: [{ kind: "item", itemId: item.id, quantity: 1 }],
  });

  await api.invoice.cancel({
    ...claim,
    invoiceId: cancelledInvoice.id,
    reason: "Duplicate invoice",
  });

  const futureInvoice = await api.invoice.post({
    ...claim,
    partyId: party.id,
    placeOfSupplyStateCode: "27",
    documentDate: `${todayDate.getUTCFullYear() + 2}-04-10`,
    lines: [{ kind: "item", itemId: item.id, quantity: 1 }],
  });

  const asOfStatement = await api.party.statement({ ...claim, partyId: party.id });
  expect(asOfStatement.header.range).toEqual({
    asOf: businessDate(new Date(), asOfStatement.header.timeZone),
  });
  expect(asOfStatement.lines.some(({ documentId }) => documentId === futureInvoice.id)).toBe(false);
  expect(asOfStatement.closingPaise).toBe(statement.closingPaise);
  expect(
    asOfStatement.lines.some(
      ({ documentId, kind }) => documentId === cancelledInvoice.id && kind === "reverse",
    ),
  ).toBe(true);

  const asOfPage = await api.party.ledgerLines({ ...claim, partyId: party.id, limit: 100 });
  expect(asOfPage.rows.map(({ id }) => id)).toEqual(asOfStatement.lines.map(({ id }) => id));
  const asOfSummary = await api.party.ledgerSummary({ ...claim, partyId: party.id });
  expect(asOfSummary.closingPaise).toBe(asOfStatement.closingPaise);
  expect(asOfSummary.debitPaise - asOfSummary.creditPaise).toBe(
    asOfStatement.closingPaise - asOfStatement.openingPaise,
  );

  const asOfXlsx = await api.export.partyStatementXlsx({ ...claim, partyId: party.id });

  const asOfStrings = readZipText(
    new Uint8Array(await asOfXlsx.arrayBuffer()),
    "xl/sharedStrings.xml",
  );

  expect(asOfStrings).toContain(">Cancellation<");
  expect(asOfStrings).not.toContain(required(futureInvoice.number, "future invoice number"));
});

test("operator cannot read the financial trial balance", async () => {
  const operator = await createTestUser("report-operator");
  await joinOrganization(operator, fixture.organization.id, "operator");
  await expectORPCCode(
    clientFor(operator).report.trialBalance({ orgSlug: fixture.organization.slug, ...claimDates }),
    "FORBIDDEN",
  );
  const api = clientFor(operator);
  const orgSlug = fixture.organization.slug;

  const accountId = required(
    fixture.accounts.find(({ code }) => code === "1001"),
    "cash",
  ).id;

  await expectORPCCode(
    api.report.accountLedgerLines({ orgSlug, accountId, ...claimDates }),
    "FORBIDDEN",
  );
  await expectORPCCode(
    api.report.accountLedgerSummary({ orgSlug, accountId, ...claimDates }),
    "FORBIDDEN",
  );
  await expectORPCCode(api.report.dayBookEntries({ orgSlug, ...claimDates }), "FORBIDDEN");
  await expectORPCCode(api.report.dayBookSummary({ orgSlug, ...claimDates }), "FORBIDDEN");
});
