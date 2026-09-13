import { expect, test } from "bun:test";

import {
  assertBalanced,
  postReceipt,
  reverseLines,
  type ReceiptPosting,
  type ResolvedAccounts,
} from "@accly/api/core/posting";
import { SYSTEM_ACCOUNT_KEYS, type SystemAccountKey } from "@accly/api/core/chart-templates";

const accounts: ResolvedAccounts = {
  paymentMethodAccountId: "bank-account",
  // SAFETY: built from the complete SYSTEM_ACCOUNT_KEYS tuple, so every key is present.
  byKey: Object.fromEntries(SYSTEM_ACCOUNT_KEYS.map((key) => [key, `${key}-account`])) as Record<
    SystemAccountKey,
    string
  >,
};

test("advance receipt debits the payment method and credits customer advances", () => {
  const lines = postReceipt(
    {
      settlementKind: "advance",
      advanceSupply: "goods",
      exposureSide: "receivable",
      partyId: "customer-1",
      amountPaise: 12_500n,
      incomeAccountId: null,
    },
    accounts,
  );

  expect(lines).toEqual([
    {
      accountId: "bank-account",
      partyId: null,
      debit: 12_500n,
      credit: 0n,
    },
    {
      accountId: "customerAdvances-account",
      partyId: "customer-1",
      debit: 0n,
      credit: 12_500n,
    },
  ]);
  expect(() => assertBalanced(lines)).not.toThrow();
});

test("direct receipt credits income and preserves its optional party", () => {
  const withParty = postReceipt(
    {
      settlementKind: "direct",
      exposureSide: null,
      partyId: "customer-1",
      amountPaise: 900n,
      incomeAccountId: "sales-income",
    },
    accounts,
  );

  const withoutParty = postReceipt(
    {
      settlementKind: "direct",
      exposureSide: null,
      partyId: null,
      amountPaise: 900n,
      incomeAccountId: "sales-income",
    },
    accounts,
  );

  expect(withParty[1]).toEqual({
    accountId: "sales-income",
    partyId: "customer-1",
    debit: 0n,
    credit: 900n,
  });
  expect(withoutParty[1]).toEqual({
    accountId: "sales-income",
    partyId: null,
    debit: 0n,
    credit: 900n,
  });
});

test("receipt posting requires a positive amount", () => {
  const validDirect: ReceiptPosting = {
    settlementKind: "direct",
    exposureSide: null,
    partyId: null,
    amountPaise: 100n,
    incomeAccountId: "sales-income",
  };

  expect(() => postReceipt({ ...validDirect, amountPaise: 0n }, accounts)).toThrow();
});

test("reverseLines swaps sides without changing account or party ids", () => {
  expect(
    reverseLines([
      { accountId: "bank-account", partyId: null, debit: 500n, credit: 0n },
      { accountId: "income-account", partyId: "customer-1", debit: 0n, credit: 500n },
    ]),
  ).toEqual([
    { accountId: "bank-account", partyId: null, debit: 0n, credit: 500n },
    { accountId: "income-account", partyId: "customer-1", debit: 500n, credit: 0n },
  ]);
});

test("assertBalanced rejects an unbalanced entry", () => {
  expect(() =>
    assertBalanced([
      { accountId: "bank-account", partyId: null, debit: 500n, credit: 0n },
      { accountId: "income-account", partyId: null, debit: 0n, credit: 499n },
    ]),
  ).toThrow();
});
