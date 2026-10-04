import { expect, test } from "bun:test";

import { db } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { documents } from "@accly/db/schema/documents";
import { journalEntries } from "@accly/db/schema/journal-entries";
import { journalLines } from "@accly/db/schema/journal-lines";
import { and, eq } from "drizzle-orm";

import { createAccountingFixture, postingOf } from "../support/accounting";
import { required } from "../support/assert";
import { createFounderSession, createTestUser, joinOrganization } from "../support/auth";
import { clientFor, expectORPCCode, expectReason } from "../support/client";
import { resetTestDatabase } from "../support/database";

type Account = typeof accounts.$inferSelect;

function journalAccountsOf(rows: Account[]) {
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
    exemptIncome: required(
      rows.find(
        ({ type, active, supplyClass }) => type === "income" && active && supplyClass === "exempt",
      ),
      "exempt income account",
    ),
    taxableIncome: required(
      rows.find(
        ({ type, active, supplyClass }) => type === "income" && active && supplyClass === "taxable",
      ),
      "taxable income account",
    ),
    receivables: required(
      rows.find(({ systemKey }) => systemKey === "receivables"),
      "receivables account",
    ),
  };
}

await resetTestDatabase();

const founder = await createFounderSession();

test("a balanced journal completes its posting, cancellation, and permission workflow", async () => {
  const fixture = await createAccountingFixture(founder, "journal-workflow");
  const { cash, bank, exemptIncome } = journalAccountsOf(fixture.accounts);
  const claim = { orgSlug: fixture.organization.slug };

  const balancesBefore = await fixture.api.account.moneyBalances(claim);

  const cashBalanceBefore = required(
    balancesBefore.find(({ id }) => id === cash.id),
    "cash balance before journal",
  ).balancePaise;

  const posted = await fixture.api.journal.post({
    ...claim,
    documentDate: "2026-04-01",
    narration: "Move funds and recognize income",
    reference: "JV-TRANSFER-1",
    lines: [
      { accountId: cash.id, side: "debit", amount: "60.00" },
      { accountId: bank.id, side: "debit", amount: "40.00" },
      { accountId: exemptIncome.id, side: "credit", amount: "100.00" },
    ],
  });

  const [detail, posting, listed, balancesAfter] = await Promise.all([
    fixture.api.journal.get({ ...claim, journalId: posted.id }),
    postingOf(fixture.organization.id, posted.id, "post"),
    fixture.api.journal.list(claim),
    fixture.api.account.moneyBalances(claim),
  ]);

  expect(detail.number).toMatch(/^JV\d{2}-\d{2}\/1$/);
  expect(detail.lines).toEqual([
    expect.objectContaining({
      side: "debit",
      accountName: cash.name,
      amountPaise: 6_000n,
    }),
    expect.objectContaining({
      side: "debit",
      accountName: bank.name,
      amountPaise: 4_000n,
    }),
    expect.objectContaining({
      side: "credit",
      accountName: exemptIncome.name,
      amountPaise: 10_000n,
    }),
  ]);

  expect(posting.lines).toHaveLength(3);
  expect(posting.lines.reduce((sum, line) => sum + line.debit, 0n)).toBe(10_000n);
  expect(posting.lines.reduce((sum, line) => sum + line.credit, 0n)).toBe(10_000n);
  expect(posting.ledger).toEqual([]);
  expect(listed.rows).toContainEqual(
    expect.objectContaining({ id: detail.id, number: detail.number }),
  );
  expect(
    required(
      balancesAfter.find(({ id }) => id === cash.id),
      "cash balance after journal",
    ).balancePaise,
  ).toBe(cashBalanceBefore + 6_000n);

  const cancelled = await fixture.api.journal.cancel({
    ...claim,
    journalId: posted.id,
    reason: "Entered twice",
  });

  expect(cancelled.state).toBe("cancelled");

  const reversal = await postingOf(fixture.organization.id, posted.id, "reverse");
  expect(reversal.entry.reversesEntryId).toBe(posting.entry.id);
  expect(reversal.lines).toHaveLength(posting.lines.length);
  expect(reversal.lines).toEqual(
    expect.arrayContaining(
      posting.lines.map((line) =>
        expect.objectContaining({
          accountId: line.accountId,
          partyId: line.partyId,
          debit: line.credit,
          credit: line.debit,
        }),
      ),
    ),
  );

  await expectORPCCode(
    fixture.api.journal.cancel({
      ...claim,
      journalId: posted.id,
      reason: "Again",
    }),
    "CONFLICT",
  );

  const ca = await createTestUser("journal-ca");
  await joinOrganization(ca, fixture.organization.id, "ca");
  await expectORPCCode(
    clientFor(ca).journal.post({
      ...claim,
      documentDate: "2026-04-01",
      narration: "Not permitted",
      lines: [
        { accountId: cash.id, side: "debit", amount: "1.00" },
        { accountId: exemptIncome.id, side: "credit", amount: "1.00" },
      ],
    }),
    "FORBIDDEN",
  );
});

test("an allocated receivables journal settles Priya, a party transfer nets the control, and both cancel cleanly", async () => {
  const fixture = await createAccountingFixture(founder, "journal-receivables");
  const { receivables } = journalAccountsOf(fixture.accounts);
  const claim = { orgSlug: fixture.organization.slug };

  const income = required(
    fixture.accounts.find(({ type, supplyClass }) => type === "income" && supplyClass === "exempt"),
    "exempt income account",
  );

  const discount = await fixture.api.account.create({
    ...claim,
    parent: { type: "expense" },
    name: "Sibling Discount",
  });

  const [priya, rahul] = await Promise.all([
    fixture.api.party.create({ ...claim, name: "Priya", roles: ["customer"], stateCode: "27" }),
    fixture.api.party.create({ ...claim, name: "Rahul", roles: ["customer"], stateCode: "27" }),
  ]);

  const item = await fixture.api.item.create({
    ...claim,
    name: "School service",
    unit: "service",
    unitPrice: "10000.00",
    incomeAccountId: income.id,
  });

  const invoice = await fixture.api.invoice.post({
    ...claim,
    partyId: priya.id,
    documentDate: "2026-09-10",
    placeOfSupplyStateCode: "27",
    lines: [{ kind: "item", itemId: item.id, quantity: 1 }],
  });

  expect(await fixture.api.journal.accounts(claim)).toContainEqual(
    expect.objectContaining({ id: receivables.id, systemKey: "receivables" }),
  );

  const discountJournal = await fixture.api.journal.post({
    ...claim,
    documentDate: "2026-09-11",
    narration: "Priya sibling discount",
    lines: [
      { accountId: discount.id, side: "debit", amount: "500.00" },
      {
        accountId: receivables.id,
        partyId: priya.id,
        side: "credit",
        amount: "500.00",
        allocations: [{ invoiceId: invoice.id, amount: "500.00" }],
      },
    ],
  });

  const [discountDetail, discountPost, invoiceAfterDiscount, priyaAfterDiscount] =
    await Promise.all([
      fixture.api.journal.get({ ...claim, journalId: discountJournal.id }),
      postingOf(fixture.organization.id, discountJournal.id, "post"),
      fixture.api.invoice.get({ ...claim, invoiceId: invoice.id }),
      fixture.api.party.statement({ ...claim, partyId: priya.id }),
    ]);

  expect(discountDetail.lines).toContainEqual(
    expect.objectContaining({
      accountId: receivables.id,
      partyId: priya.id,
      accountSystemKey: "receivables",
    }),
  );
  expect(discountDetail.allocationsApplied).toContainEqual(
    expect.objectContaining({ otherDocumentId: invoice.id, amountPaise: 50_000n, reversed: false }),
  );
  const allocation = required(discountDetail.allocationsApplied[0], "journal allocation");
  expect(
    await db
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.orgId, fixture.organization.id),
          eq(journalEntries.documentId, allocation.id),
        ),
      ),
  ).toEqual([]);
  expect(discountPost.lines).toContainEqual(
    expect.objectContaining({
      accountId: receivables.id,
      partyId: priya.id,
      debit: 0n,
      credit: 50_000n,
    }),
  );
  expect(discountPost.ledger.filter(({ kind }) => kind === "post")).toEqual([
    expect.objectContaining({
      partyId: priya.id,
      side: "receivable",
      amountPaise: -50_000n,
    }),
  ]);
  expect(invoiceAfterDiscount.outstandingPaise).toBe(950_000n);
  expect(priyaAfterDiscount.closingPaise).toBe(950_000n);
  await expectReason(
    fixture.api.journal.post({
      ...claim,
      documentDate: "2026-09-12",
      narration: "Allocation exceeds net party credit",
      lines: [
        { accountId: receivables.id, partyId: priya.id, side: "debit", amount: "100.00" },
        {
          accountId: receivables.id,
          partyId: priya.id,
          side: "credit",
          amount: "500.00",
          allocations: [{ invoiceId: invoice.id, amount: "500.00" }],
        },
        { accountId: discount.id, side: "debit", amount: "400.00" },
      ],
    }),
    "ALLOCATION_EXCEEDS_SOURCE",
  );

  const transfer = await fixture.api.journal.post({
    ...claim,
    documentDate: "2026-09-12",
    narration: "Transfer sibling balance",
    lines: [
      { accountId: receivables.id, partyId: rahul.id, side: "debit", amount: "2000.00" },
      { accountId: receivables.id, partyId: priya.id, side: "credit", amount: "2000.00" },
    ],
  });

  const transferPost = await postingOf(fixture.organization.id, transfer.id, "post");
  expect(transferPost.lines.reduce((sum, line) => sum + line.debit - line.credit, 0n)).toBe(0n);
  expect(transferPost.ledger.filter(({ kind }) => kind === "post")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ partyId: rahul.id, amountPaise: 200_000n }),
      expect.objectContaining({ partyId: priya.id, amountPaise: -200_000n }),
    ]),
  );
  expect(transferPost.ledger.filter(({ kind }) => kind === "post")).toHaveLength(2);
  expect((await fixture.api.party.statement({ ...claim, partyId: priya.id })).closingPaise).toBe(
    750_000n,
  );
  expect((await fixture.api.party.statement({ ...claim, partyId: rahul.id })).closingPaise).toBe(
    200_000n,
  );

  await fixture.api.journal.cancel({ ...claim, journalId: transfer.id, reason: "Undo transfer" });
  expect((await fixture.api.party.statement({ ...claim, partyId: priya.id })).closingPaise).toBe(
    950_000n,
  );
  expect((await fixture.api.party.statement({ ...claim, partyId: rahul.id })).closingPaise).toBe(
    0n,
  );
  await fixture.api.journal.cancel({
    ...claim,
    journalId: discountJournal.id,
    reason: "Undo discount",
  });
  expect(
    (await fixture.api.invoice.get({ ...claim, invoiceId: invoice.id })).outstandingPaise,
  ).toBe(1_000_000n);
  expect((await fixture.api.party.statement({ ...claim, partyId: priya.id })).closingPaise).toBe(
    1_000_000n,
  );
  expect(
    (await fixture.api.journal.get({ ...claim, journalId: discountJournal.id })).allocationsApplied,
  ).toContainEqual(expect.objectContaining({ otherDocumentId: invoice.id, reversed: true }));
});

test("a Rahul journal debit is an open item until a receipt settles it, and blocks cancellation", async () => {
  const fixture = await createAccountingFixture(founder, "journal-open-item");
  const { receivables } = journalAccountsOf(fixture.accounts);

  const paymentMethod = required(
    fixture.methods.find(({ name }) => name === "Bank transfer"),
    "bank transfer payment method",
  );

  const claim = { orgSlug: fixture.organization.slug };

  const [priya, rahul] = await Promise.all([
    fixture.api.party.create({ ...claim, name: "Priya", roles: ["customer"], stateCode: "27" }),
    fixture.api.party.create({ ...claim, name: "Rahul", roles: ["customer"], stateCode: "27" }),
  ]);

  const transfer = await fixture.api.journal.post({
    ...claim,
    documentDate: "2026-09-12",
    narration: "Transfer sibling balance",
    lines: [
      { accountId: receivables.id, partyId: rahul.id, side: "debit", amount: "2000.00" },
      { accountId: receivables.id, partyId: priya.id, side: "credit", amount: "2000.00" },
    ],
  });

  const beforeBalance = (await fixture.api.party.statement({ ...claim, partyId: rahul.id }))
    .closingPaise;

  const receivablesBalanceQuery = db
    .select({ debit: journalLines.debit, credit: journalLines.credit })
    .from(journalLines)
    .where(
      and(
        eq(journalLines.orgId, fixture.organization.id),
        eq(journalLines.accountId, receivables.id),
      ),
    );

  const beforeAccountBalance = (await receivablesBalanceQuery.execute()).reduce(
    (balance, { debit, credit }) => balance + debit - credit,
    0n,
  );

  expect(beforeBalance).toBe(200_000n);
  expect(
    (await fixture.api.party.openItems({ ...claim, partyId: rahul.id, side: "receivable" })).rows,
  ).toContainEqual(
    expect.objectContaining({
      id: transfer.id,
      type: "journal",
      number: transfer.number,
      dueDate: null,
      outstandingPaise: 200_000n,
    }),
  );

  // An operator may post receipts but not read journals: none is offered or settled.
  const operator = await createTestUser("journal-operator");
  await joinOrganization(operator, fixture.organization.id, "operator");
  expect(
    (
      await clientFor(operator).party.openItems({ ...claim, partyId: rahul.id, side: "receivable" })
    ).rows.some(({ id }) => id === transfer.id),
  ).toBe(false);
  await expectORPCCode(
    clientFor(operator).receipt.post({
      ...claim,
      settlementKind: "against",
      partyId: rahul.id,
      amount: "2000.00",
      paymentMethodId: paymentMethod.id,
      documentDate: "2026-09-12",
      allocations: [{ documentId: transfer.id, amount: "2000.00" }],
    }),
    "FORBIDDEN",
  );

  await expectReason(
    fixture.api.receipt.post({
      ...claim,
      settlementKind: "against",
      partyId: priya.id,
      amount: "2000.00",
      paymentMethodId: paymentMethod.id,
      documentDate: "2026-09-12",
      allocations: [{ documentId: transfer.id, amount: "2000.00" }],
    }),
    "ALLOCATION_TARGET_INVALID",
  );

  const receipt = await fixture.api.receipt.post({
    ...claim,
    settlementKind: "against",
    partyId: rahul.id,
    amount: "2000.00",
    paymentMethodId: paymentMethod.id,
    documentDate: "2026-09-12",
    allocations: [{ documentId: transfer.id, amount: "2000.00" }],
  });

  const afterAccountBalance = (await receivablesBalanceQuery.execute()).reduce(
    (balance, { debit, credit }) => balance + debit - credit,
    0n,
  );

  expect((await fixture.api.party.statement({ ...claim, partyId: rahul.id })).closingPaise).toBe(
    beforeBalance - 200_000n,
  );
  expect(afterAccountBalance).toBe(beforeAccountBalance - 200_000n);
  expect(
    (
      await fixture.api.party.openItems({ ...claim, partyId: rahul.id, side: "receivable" })
    ).rows.some(({ id }) => id === transfer.id),
  ).toBe(false);

  const conflict = await expectORPCCode(
    fixture.api.journal.cancel({ ...claim, journalId: transfer.id, reason: "Undo transfer" }),
    "CONFLICT",
  );

  expect(conflict.message).toContain(receipt.number);

  // The journal record shows the receipt that blocks its cancellation.
  const journalDetail = await fixture.api.journal.get({ ...claim, journalId: transfer.id });

  const allocation = required(
    journalDetail.allocationsReceived.find(({ otherDocumentId }) => otherDocumentId === receipt.id),
    "Rahul journal settlement",
  );

  expect(
    (await clientFor(operator).receipt.get({ ...claim, receiptId: receipt.id })).allocations,
  ).toEqual([]);

  await fixture.api.allocation.reverse({
    ...claim,
    allocationId: allocation.id,
    reason: "Undo journal settlement",
  });
  await fixture.api.journal.cancel({
    ...claim,
    journalId: transfer.id,
    reason: "Undo transfer",
  });
});

test("receivables debits and credits net once per party, omitting a zero balance", async () => {
  const fixture = await createAccountingFixture(founder, "journal-party-net");
  const { receivables } = journalAccountsOf(fixture.accounts);
  const claim = { orgSlug: fixture.organization.slug };

  const expense = await fixture.api.account.create({
    ...claim,
    parent: { type: "expense" },
    name: "Sibling Discount",
  });

  const [priya, rahul] = await Promise.all([
    fixture.api.party.create({ ...claim, name: "Priya", roles: ["customer"], stateCode: "27" }),
    fixture.api.party.create({ ...claim, name: "Rahul", roles: ["customer"], stateCode: "27" }),
  ]);

  const journal = await fixture.api.journal.post({
    ...claim,
    documentDate: "2026-09-12",
    narration: "Net party control lines",
    lines: [
      { accountId: receivables.id, partyId: priya.id, side: "debit", amount: "200.00" },
      { accountId: receivables.id, partyId: priya.id, side: "credit", amount: "300.00" },
      { accountId: receivables.id, partyId: rahul.id, side: "debit", amount: "50.00" },
      { accountId: receivables.id, partyId: rahul.id, side: "credit", amount: "50.00" },
      { accountId: expense.id, side: "debit", amount: "100.00" },
    ],
  });

  const posted = await postingOf(fixture.organization.id, journal.id, "post");
  expect(posted.ledger).toEqual([
    expect.objectContaining({
      partyId: priya.id,
      side: "receivable",
      kind: "post",
      amountPaise: -10_000n,
    }),
  ]);
  expect((await fixture.api.party.statement({ ...claim, partyId: priya.id })).closingPaise).toBe(
    -10_000n,
  );
  expect((await fixture.api.party.statement({ ...claim, partyId: rahul.id })).closingPaise).toBe(
    0n,
  );

  await fixture.api.journal.cancel({ ...claim, journalId: journal.id, reason: "Undo party net" });
  const reversed = await postingOf(fixture.organization.id, journal.id, "reverse");
  expect(reversed.ledger).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ partyId: priya.id, kind: "reverse", amountPaise: 10_000n }),
    ]),
  );
  expect(reversed.ledger).toHaveLength(2);
  expect((await fixture.api.party.statement({ ...claim, partyId: priya.id })).closingPaise).toBe(
    0n,
  );
});

test("a receivables journal line requires a party and only credits may allocate", async () => {
  const fixture = await createAccountingFixture(founder, "journal-control-refusals");
  const { receivables, cash } = journalAccountsOf(fixture.accounts);
  const claim = { orgSlug: fixture.organization.slug };

  const party = await fixture.api.party.create({
    ...claim,
    name: "Journal customer",
    roles: ["customer"],
    stateCode: "27",
  });

  await expectReason(
    fixture.api.journal.post({
      ...claim,
      documentDate: "2026-09-11",
      narration: "Missing party",
      lines: [
        { accountId: cash.id, side: "debit", amount: "1.00" },
        { accountId: receivables.id, side: "credit", amount: "1.00" },
      ],
    }),
    "PARTY_REQUIRED",
  );
  await expectReason(
    fixture.api.journal.post({
      ...claim,
      documentDate: "2026-09-11",
      narration: "Debit allocation",
      lines: [
        {
          accountId: receivables.id,
          partyId: party.id,
          side: "debit",
          amount: "1.00",
          allocations: [{ invoiceId: crypto.randomUUID(), amount: "1.00" }],
        },
        { accountId: cash.id, side: "credit", amount: "1.00" },
      ],
    }),
    "ALLOCATION_TARGET_INVALID",
  );
  await expectReason(
    fixture.api.journal.post({
      ...claim,
      documentDate: "2026-09-11",
      narration: "Allocation on cash",
      lines: [
        {
          accountId: cash.id,
          side: "debit",
          amount: "1.00",
          allocations: [{ invoiceId: crypto.randomUUID(), amount: "1.00" }],
        },
        { accountId: receivables.id, partyId: party.id, side: "credit", amount: "1.00" },
      ],
    }),
    "ALLOCATION_TARGET_INVALID",
  );
});

test("journal posting refuses unbalanced lines and foreign parties", async () => {
  const fixture = await createAccountingFixture(founder, "journal-refusals");
  const foreign = await createAccountingFixture(founder, "journal-foreign-party");
  const { cash, exemptIncome } = journalAccountsOf(fixture.accounts);

  const foreignParty = await foreign.api.party.create({
    orgSlug: foreign.organization.slug,
    name: "Foreign journal party",
    roles: ["customer"],
    stateCode: "27",
  });

  const claim = { orgSlug: fixture.organization.slug };

  await expectORPCCode(
    fixture.api.journal.post({
      ...claim,
      documentDate: "2026-04-01",
      narration: "Unbalanced journal",
      lines: [
        { accountId: cash.id, side: "debit", amount: "2.00" },
        { accountId: exemptIncome.id, side: "credit", amount: "1.00" },
      ],
    }),
    "BAD_REQUEST",
  );

  await expectReason(
    fixture.api.journal.post({
      ...claim,
      documentDate: "2026-04-01",
      narration: "Foreign party",
      lines: [
        { accountId: cash.id, partyId: foreignParty.id, side: "debit", amount: "1.00" },
        { accountId: exemptIncome.id, side: "credit", amount: "1.00" },
      ],
    }),
    "PARTY_INVALID",
  );
});

test("registered organizations hide and refuse taxable journal accounts", async () => {
  const fixture = await createAccountingFixture(founder, "journal-gstin", {
    gstin: "27ABCDE1234F1Z5",
    stateCode: "27",
    pan: "ABCDE1234F",
  });

  const { cash, exemptIncome, taxableIncome } = journalAccountsOf(fixture.accounts);
  const claim = { orgSlug: fixture.organization.slug };

  const available = await fixture.api.journal.accounts(claim);
  expect(available.some(({ supplyClass }) => supplyClass === "taxable")).toBe(false);
  expect(available.some(({ id }) => id === exemptIncome.id)).toBe(true);

  await expectReason(
    fixture.api.journal.post({
      ...claim,
      documentDate: "2026-04-01",
      narration: "Taxable income must be invoiced",
      lines: [
        { accountId: cash.id, side: "debit", amount: "1.00" },
        { accountId: taxableIncome.id, side: "credit", amount: "1.00" },
      ],
    }),
    "TAXABLE_ACCOUNT_LINE",
  );
});

test("a GST payment journal posts and respects the tax lock with books open", async () => {
  const fixture = await createAccountingFixture(founder, "journal-gst-payment", {
    gstin: "27ABCDE1234F1Z5",
    stateCode: "27",
    pan: "ABCDE1234F",
  });

  const { bank } = journalAccountsOf(fixture.accounts);

  const output = required(
    fixture.accounts.find(({ systemKey }) => systemKey === "cgstOutput"),
    "CGST output account",
  );

  const claim = { orgSlug: fixture.organization.slug };

  const input = {
    ...claim,
    documentDate: "2026-04-01",
    narration: "Pay CGST liability",
    lines: [
      { accountId: output.id, side: "debit" as const, amount: "100.00" },
      { accountId: bank.id, side: "credit" as const, amount: "100.00" },
    ],
  };

  expect(await fixture.api.journal.accounts(claim)).toContainEqual(
    expect.objectContaining({ id: output.id, systemKey: "cgstOutput" }),
  );
  const posted = await fixture.api.journal.post(input);
  const posting = await postingOf(fixture.organization.id, posted.id, "post");
  expect(posting.lines).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ accountId: output.id, debit: 10_000n, credit: 0n }),
      expect.objectContaining({ accountId: bank.id, debit: 0n, credit: 10_000n }),
    ]),
  );
  expect(
    await db
      .select({ affectsTax: documents.affectsTax })
      .from(documents)
      .where(and(eq(documents.orgId, fixture.organization.id), eq(documents.id, posted.id))),
  ).toEqual([{ affectsTax: true }]);

  const owner = clientFor(founder);
  expect((await owner.lock.get(claim)).general).toBeNull();
  await owner.lock.set({
    ...claim,
    kind: "tax",
    lockedThrough: input.documentDate,
    expectedLockedThrough: null,
    reason: "GST period filed",
  });
  await expectReason(fixture.api.journal.post(input), "LOCKED");
});

// The start month names every financial year and number series, so it is fixed once
// any document carries a number.
test("the fiscal year start is fixed once a document is numbered", async () => {
  const fixture = await createAccountingFixture(founder, "fiscal-year");
  const { cash, exemptIncome } = journalAccountsOf(fixture.accounts);
  const claim = { orgSlug: fixture.organization.slug };
  const owner = clientFor(founder);

  const january = await owner.settings.update({
    ...(await owner.settings.get(claim)),
    ...claim,
    financialYearStart: 1,
  });

  expect(january.financialYearStart).toBe(1);

  await fixture.api.journal.post({
    ...claim,
    documentDate: "2026-04-01",
    narration: "First numbered document",
    lines: [
      { accountId: cash.id, side: "debit", amount: "1.00" },
      { accountId: exemptIncome.id, side: "credit", amount: "1.00" },
    ],
  });

  await expectReason(
    owner.settings.update({ ...january, ...claim, financialYearStart: 4 }),
    "FINANCIAL_YEAR_FIXED",
  );
  expect((await owner.settings.update({ ...january, ...claim, city: "Pimpri" })).city).toBe(
    "Pimpri",
  );
});
