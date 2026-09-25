import { expect, test } from "bun:test";

import {
  assertBalanced,
  computeTds,
  postAllocation,
  postBill,
  postCreditNote,
  postDebitNote,
  postInvoice,
  postJournal,
  postPayment,
  postReceipt,
  reverseLines,
  type BillPosting,
  type CreditNotePosting,
  type DebitNotePosting,
  type InvoicePosting,
  type JournalPosting,
  type PaymentPosting,
  type ReceiptPosting,
} from "@accly/api/core/posting";
import { receiptTax } from "@accly/api/core/documents";
import { SYSTEM_ACCOUNT_KEYS } from "@accly/api/core/chart-templates";

const accounts = new Map(SYSTEM_ACCOUNT_KEYS.map((key) => [key, `${key}-account`]));

const balanced: JournalPosting = {
  type: "journal",
  amountPaise: 10_000n,
  lines: [
    { accountId: "cash", partyId: null, side: "debit", amountPaise: 6_000n },
    { accountId: "bank", partyId: "party-1", side: "debit", amountPaise: 4_000n },
    { accountId: "income", partyId: null, side: "credit", amountPaise: 10_000n },
  ],
};

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
      adjustments: [],
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
      adjustments: [],
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

test("receipt against invoices rejects allocations above its capacity", () => {
  expect(() =>
    assertBalanced(
      postReceipt(
        {
          type: "receipt",
          methodAccountId: "bank-account",
          settlementKind: "against",
          exposureSide: "receivable",
          partyId: "customer-1",
          accountId: null,
          amountPaise: 12_500n,
          allocations: [{ documentId: "invoice-1", amountPaise: 12_501n }],
          adjustments: [],
          advanceSupply: null,
        },
        accounts,
      ),
    ),
  ).toThrow("Journal entry is not balanced");
});

test("advance allocation moves the party balance from advances to receivables", () => {
  const lines = postAllocation(
    {
      type: "allocation",
      side: "receivable",
      direction: "apply",
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
      side: "receivable",
      direction: "release",
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

test("maps balanced lines in order and preserves parties", () => {
  expect(postJournal(balanced)).toEqual([
    { accountId: "cash", partyId: null, debit: 6_000n, credit: 0n },
    { accountId: "bank", partyId: "party-1", debit: 4_000n, credit: 0n },
    { accountId: "income", partyId: null, debit: 0n, credit: 10_000n },
  ]);
});

test("rejects unbalanced totals", () => {
  expect(() =>
    postJournal({
      ...balanced,
      lines: [balanced.lines[0]!, { ...balanced.lines[2]!, amountPaise: 5_999n }],
    }),
  ).toThrow();
});

test("rejects fewer than two lines", () => {
  expect(() => postJournal({ ...balanced, lines: [balanced.lines[0]!] })).toThrow();
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

test("bill posts eligible input tax, ineligible line tax, TDS, and positive round-off", () => {
  const bill: BillPosting = {
    type: "bill",
    exposureSide: "payable",
    partyId: "vendor-1",
    amountPaise: 13_801n,
    lines: [
      { accountId: "supplies", amountPaise: 10_000n },
      // This line already includes its ineligible input tax.
      { accountId: "repairs", amountPaise: 2_000n },
    ],
    cgstPaise: 900n,
    sgstPaise: 900n,
    igstPaise: 0n,
    roundOffPaise: 1n,
    tdsPaise: 100n,
  };

  const lines = postBill(bill, accounts);
  expect(
    lines.map(({ accountId, partyId, debit, credit }) => [accountId, partyId, debit, credit]),
  ).toEqual([
    ["supplies", null, 10_000n, 0n],
    ["repairs", null, 2_000n, 0n],
    ["cgstInput-account", null, 900n, 0n],
    ["sgstInput-account", null, 900n, 0n],
    ["roundOff-account", null, 1n, 0n],
    ["tdsPayable-account", "vendor-1", 0n, 100n],
    ["payables-account", "vendor-1", 0n, 13_701n],
  ]);
});

test("credit note mirrors invoice income, tax, and round-off", () => {
  const note: CreditNotePosting = {
    type: "creditNote",
    exposureSide: "receivable",
    partyId: "customer-1",
    amountPaise: 11_801n,
    lines: [{ accountId: "income", amountPaise: 10_000n }],
    cgstPaise: 900n,
    sgstPaise: 900n,
    igstPaise: 0n,
    roundOffPaise: 1n,
  };

  expect(
    postCreditNote(note, accounts).map(({ accountId, debit, credit }) => [
      accountId,
      debit,
      credit,
    ]),
  ).toEqual([
    ["receivables-account", 0n, 11_801n],
    ["income", 10_000n, 0n],
    ["cgstOutput-account", 900n, 0n],
    ["sgstOutput-account", 900n, 0n],
    ["roundOff-account", 1n, 0n],
  ]);
});

test("debit note mirrors bill expense, input tax, and round-off", () => {
  const note: DebitNotePosting = {
    type: "debitNote",
    exposureSide: "payable",
    partyId: "vendor-1",
    amountPaise: 5_901n,
    lines: [{ accountId: "supplies", amountPaise: 5_000n }],
    cgstPaise: 450n,
    sgstPaise: 450n,
    igstPaise: 0n,
    roundOffPaise: 1n,
  };

  expect(
    postDebitNote(note, accounts).map(({ accountId, debit, credit }) => [accountId, debit, credit]),
  ).toEqual([
    ["supplies", 0n, 5_000n],
    ["cgstInput-account", 0n, 450n],
    ["sgstInput-account", 0n, 450n],
    ["roundOff-account", 0n, 1n],
    ["payables-account", 5_901n, 0n],
  ]);
});

test("payment against bills settles write-off and advance remainder while fee increases cash paid", () => {
  const lines = postPayment(
    {
      type: "payment",
      methodAccountId: "bank",
      settlementKind: "against",
      exposureSide: "payable",
      partyId: "vendor-1",
      accountId: null,
      amountPaise: 9_000n,
      allocations: [{ documentId: "bill-1", amountPaise: 9_500n }],
      writeOffs: [{ accountId: "discount", amountPaise: 1_000n }],
      fee: { accountId: "bank-fees", amountPaise: 50n },
      tds: null,
    },
    accounts,
  );

  expect(lines.map(({ accountId, debit, credit }) => [accountId, debit, credit])).toEqual([
    ["payables-account", 9_500n, 0n],
    ["supplierAdvances-account", 500n, 0n],
    ["bank", 0n, 9_050n],
    ["discount", 0n, 1_000n],
    ["bank-fees", 50n, 0n],
  ]);
});

test("refund payment debits receivables and credits the payment method", () => {
  const lines = postPayment(
    {
      type: "payment",
      methodAccountId: "bank",
      settlementKind: "against",
      exposureSide: "receivable",
      partyId: "customer-1",
      accountId: null,
      amountPaise: 3_000n,
      sources: [{ documentId: "credit-note-1", amountPaise: 3_000n }],
      tds: null,
    },
    accounts,
  );

  expect(lines).toEqual([
    { accountId: "receivables-account", partyId: "customer-1", debit: 3_000n, credit: 0n },
    { accountId: "bank", partyId: null, debit: 0n, credit: 3_000n },
  ]);
});

test("receipt against invoices settles customer fee and TDS with no extra advance", () => {
  const lines = postReceipt(
    {
      type: "receipt",
      methodAccountId: "bank",
      settlementKind: "against",
      exposureSide: "receivable",
      partyId: "customer-1",
      accountId: null,
      amountPaise: 9_000n,
      allocations: [{ documentId: "invoice-1", amountPaise: 9_500n }],
      adjustments: [
        { kind: "fee", accountId: "bank-fees", amountPaise: 200n },
        { kind: "tds", amountPaise: 300n },
      ],
      advanceSupply: null,
    },
    accounts,
  );

  expect(lines).toEqual([
    { accountId: "bank", partyId: null, debit: 9_000n, credit: 0n },
    { accountId: "bank-fees", partyId: null, debit: 200n, credit: 0n },
    { accountId: "tdsReceivable-account", partyId: null, debit: 300n, credit: 0n },
    { accountId: "receivables-account", partyId: "customer-1", debit: 0n, credit: 9_500n },
  ]);
});

test("payable allocation apply and release transfer between payables and supplier advances", () => {
  const posting = {
    type: "allocation",
    side: "payable",
    partyId: "vendor-1",
    amountPaise: 1_200n,
  } as const;

  const apply = postAllocation({ ...posting, direction: "apply" }, accounts);
  expect(apply).toEqual([
    { accountId: "payables-account", partyId: "vendor-1", debit: 1_200n, credit: 0n },
    { accountId: "supplierAdvances-account", partyId: "vendor-1", debit: 0n, credit: 1_200n },
  ]);
  expect(postAllocation({ ...posting, direction: "release" }, accounts)).toEqual(
    reverseLines(apply),
  );
});
