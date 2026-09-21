import { expect, test } from "bun:test";

import { accounts } from "@accly/db/schema/accounts";

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

test("journal posting refuses control accounts, unbalanced lines, and foreign parties", async () => {
  const fixture = await createAccountingFixture(founder, "journal-refusals");
  const foreign = await createAccountingFixture(founder, "journal-foreign-party");
  const { cash, exemptIncome, receivables } = journalAccountsOf(fixture.accounts);

  const foreignParty = await foreign.api.party.create({
    orgSlug: foreign.organization.slug,
    name: "Foreign journal party",
    roles: ["customer"],
    stateCode: "27",
  });

  const claim = { orgSlug: fixture.organization.slug };

  await expectReason(
    fixture.api.journal.post({
      ...claim,
      documentDate: "2026-04-01",
      narration: "Invalid control account",
      lines: [
        { accountId: receivables.id, side: "debit", amount: "1.00" },
        { accountId: exemptIncome.id, side: "credit", amount: "1.00" },
      ],
    }),
    "ACCOUNT_INVALID",
  );

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
