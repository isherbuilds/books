import { expect, test } from "bun:test";

import {
  assertBalanced,
  computeTds,
  postInvoice,
  postAllocation,
  postPayment,
  postReceipt,
  reverseLines,
  type InvoicePosting,
  type PaymentPosting,
  type ReceiptPosting,
} from "@accly/api/core/posting";
import { receiptTax } from "@accly/api/core/documents";
import { SYSTEM_ACCOUNT_KEYS } from "@accly/api/core/chart-templates";

const accounts = new Map(SYSTEM_ACCOUNT_KEYS.map((key) => [key, `${key}-account`]));

test("receipt tax classifies registered direct income once", () => {
  expect(receiptTax(null, "exempt")).toEqual({ refused: false, affectsTax: false });
  expect(receiptTax("27ABCDE1234F1Z5", "taxable")).toEqual({ refused: true, affectsTax: true });
  expect(receiptTax("27ABCDE1234F1Z5", "exempt")).toEqual({ refused: false, affectsTax: true });
  expect(receiptTax("27ABCDE1234F1Z5", "notASupply")).toEqual({
    refused: false,
    affectsTax: false,
  });
});

test("advance receipt debits the payment method and credits customer advances", () => {
  const lines = postReceipt(
    {
      type: "receipt",
      methodAccountId: "bank-account",
      settlementKind: "advance",
      advanceSupply: "goods",
      exposureSide: "receivable",
      partyId: "customer-1",
      amountPaise: 12_500n,
      accountId: null,
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
      type: "receipt",
      methodAccountId: "bank-account",
      settlementKind: "direct",
      exposureSide: null,
      partyId: "customer-1",
      amountPaise: 900n,
      accountId: "sales-income",
    },
    accounts,
  );

  const withoutParty = postReceipt(
    {
      type: "receipt",
      methodAccountId: "bank-account",
      settlementKind: "direct",
      exposureSide: null,
      partyId: null,
      amountPaise: 900n,
      accountId: "sales-income",
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

test("receipt against invoices credits receivables and keeps no advance when fully allocated", () => {
  const lines = postReceipt(
    {
      type: "receipt",
      methodAccountId: "bank-account",
      settlementKind: "against",
      exposureSide: "receivable",
      partyId: "customer-1",
      accountId: null,
      amountPaise: 12_500n,
      allocations: [{ documentId: "invoice-1", amountPaise: 12_500n }],
      advanceSupply: null,
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
      accountId: "receivables-account",
      partyId: "customer-1",
      debit: 0n,
      credit: 12_500n,
    },
  ]);
  expect(() => assertBalanced(lines)).not.toThrow();
});

test("receipt against invoices credits an unallocated remainder to customer advances", () => {
  const lines = postReceipt(
    {
      type: "receipt",
      methodAccountId: "bank-account",
      settlementKind: "against",
      exposureSide: "receivable",
      partyId: "customer-1",
      accountId: null,
      amountPaise: 12_500n,
      allocations: [
        { documentId: "invoice-1", amountPaise: 6_000n },
        { documentId: "invoice-2", amountPaise: 4_000n },
      ],
      advanceSupply: "exempt",
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
      accountId: "receivables-account",
      partyId: "customer-1",
      debit: 0n,
      credit: 10_000n,
    },
    {
      accountId: "customerAdvances-account",
      partyId: "customer-1",
      debit: 0n,
      credit: 2_500n,
    },
  ]);
  expect(() => assertBalanced(lines)).not.toThrow();
});

test("receipt against invoices cannot balance an allocation greater than its amount", () => {
  const lines = postReceipt(
    {
      type: "receipt",
      methodAccountId: "bank-account",
      settlementKind: "against",
      exposureSide: "receivable",
      partyId: "customer-1",
      accountId: null,
      amountPaise: 12_500n,
      allocations: [{ documentId: "invoice-1", amountPaise: 12_501n }],
      advanceSupply: null,
    },
    accounts,
  );

  expect(() => assertBalanced(lines)).toThrow("Journal entry is not balanced");
});

test("advance allocation moves the party balance from advances to receivables", () => {
  const lines = postAllocation(
    {
      type: "allocation",
      direction: "advanceToInvoice",
      partyId: "customer-1",
      amountPaise: 2_500n,
    },
    accounts,
  );

  expect(lines).toEqual([
    {
      accountId: "customerAdvances-account",
      partyId: "customer-1",
      debit: 2_500n,
      credit: 0n,
    },
    {
      accountId: "receivables-account",
      partyId: "customer-1",
      debit: 0n,
      credit: 2_500n,
    },
  ]);
  expect(() => assertBalanced(lines)).not.toThrow();
});

test("reversing a post-time allocation moves the party balance from receivables to advances", () => {
  const lines = postAllocation(
    {
      type: "allocation",
      direction: "invoiceToAdvance",
      partyId: "customer-1",
      amountPaise: 2_500n,
    },
    accounts,
  );

  expect(lines).toEqual([
    {
      accountId: "customerAdvances-account",
      partyId: "customer-1",
      debit: 0n,
      credit: 2_500n,
    },
    {
      accountId: "receivables-account",
      partyId: "customer-1",
      debit: 2_500n,
      credit: 0n,
    },
  ]);
  expect(() => assertBalanced(lines)).not.toThrow();
});

test("receipt posting requires a positive amount", () => {
  const validDirect: ReceiptPosting = {
    type: "receipt",
    methodAccountId: "bank-account",
    settlementKind: "direct",
    exposureSide: null,
    partyId: null,
    amountPaise: 100n,
    accountId: "sales-income",
  };

  expect(() => postReceipt({ ...validDirect, amountPaise: 0n }, accounts)).toThrow();
});

test("advance payment deducts 2% contractor TDS and credits the vendor advance", () => {
  const amountPaise = 10_000_000n;
  const tdsPaise = computeTds(amountPaise, 200);

  const lines = postPayment(
    {
      type: "payment",
      methodAccountId: "bank-account",
      settlementKind: "advance",
      exposureSide: "payable",
      partyId: "vendor-1",
      accountId: null,
      amountPaise,
      tds: { sectionId: "sec", amountPaise: tdsPaise },
    },
    accounts,
  );

  expect(lines).toEqual([
    {
      accountId: "supplierAdvances-account",
      partyId: "vendor-1",
      debit: 10_000_000n,
      credit: 0n,
    },
    {
      accountId: "bank-account",
      partyId: null,
      debit: 0n,
      credit: 9_800_000n,
    },
    {
      accountId: "tdsPayable-account",
      partyId: "vendor-1",
      debit: 0n,
      credit: 200_000n,
    },
  ]);
  expect(() => assertBalanced(lines)).not.toThrow();

  const zeroTdsLines = postPayment(
    {
      type: "payment",
      methodAccountId: "bank-account",
      settlementKind: "advance",
      exposureSide: "payable",
      partyId: "vendor-1",
      accountId: null,
      amountPaise,
      tds: { sectionId: "sec", amountPaise: 0n },
    },
    accounts,
  );

  expect(zeroTdsLines).toHaveLength(2);
});

test("direct payment without TDS has two lines and preserves its optional party", () => {
  const lines = postPayment(
    {
      type: "payment",
      methodAccountId: "bank-account",
      settlementKind: "direct",
      exposureSide: null,
      partyId: "vendor-1",
      accountId: "repairs-expense",
      amountPaise: 25_000n,
      tds: null,
    },
    accounts,
  );

  expect(lines).toEqual([
    {
      accountId: "repairs-expense",
      partyId: "vendor-1",
      debit: 25_000n,
      credit: 0n,
    },
    {
      accountId: "bank-account",
      partyId: null,
      debit: 0n,
      credit: 25_000n,
    },
  ]);
});

test("computeTds rounds half-up to the nearest rupee", () => {
  expect(computeTds(1_234_560n, 100)).toBe(12_300n);
  expect(computeTds(123_455n, 1_000)).toBe(12_300n);
  expect(computeTds(123_500n, 1_000)).toBe(12_400n);
});

test("payment posting rejects TDS equal to or greater than the gross amount", () => {
  const payment: PaymentPosting = {
    type: "payment",
    methodAccountId: "bank-account",
    settlementKind: "direct",
    exposureSide: null,
    partyId: "vendor-1",
    accountId: "repairs-expense",
    amountPaise: 10_000n,
    tds: { sectionId: "sec", amountPaise: 10_000n },
  };

  expect(() => postPayment(payment, accounts)).toThrow();
  expect(() =>
    postPayment({ ...payment, tds: { sectionId: "sec", amountPaise: 10_100n } }, accounts),
  ).toThrow();
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

test("invoice posting groups income accounts and posts tax and positive round-off", () => {
  const invoice: InvoicePosting = {
    type: "invoice",
    exposureSide: "receivable",
    partyId: "customer-1",
    amountPaise: 41_301n,
    lines: [
      { accountId: "sales-income", amountPaise: 10_000n },
      { accountId: "sales-income", amountPaise: 5_000n },
      { accountId: "services-income", amountPaise: 20_000n },
    ],
    cgstPaise: 3_150n,
    sgstPaise: 3_150n,
    igstPaise: 0n,
    roundOffPaise: 1n,
  };

  const lines = postInvoice(invoice, accounts);

  expect(lines).toEqual([
    {
      accountId: "receivables-account",
      partyId: "customer-1",
      debit: 41_301n,
      credit: 0n,
    },
    {
      accountId: "sales-income",
      partyId: null,
      debit: 0n,
      credit: 15_000n,
    },
    {
      accountId: "services-income",
      partyId: null,
      debit: 0n,
      credit: 20_000n,
    },
    {
      accountId: "cgstOutput-account",
      partyId: null,
      debit: 0n,
      credit: 3_150n,
    },
    {
      accountId: "sgstOutput-account",
      partyId: null,
      debit: 0n,
      credit: 3_150n,
    },
    {
      accountId: "roundOff-account",
      partyId: null,
      debit: 0n,
      credit: 1n,
    },
  ]);
  expect(() => assertBalanced(lines)).not.toThrow();
  expect(() => assertBalanced(postInvoice({ ...invoice, amountPaise: 41_300n }, accounts))).toThrow(
    "Journal entry is not balanced",
  );
});
