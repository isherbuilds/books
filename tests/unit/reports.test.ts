import { expect, test } from "bun:test";

import {
  buildBalanceSheet,
  buildProfitAndLoss,
  buildTrialBalance,
  type StatementAccount,
  type TrialBalanceAccount,
} from "@accly/api/core/reports";

const accounts: TrialBalanceAccount[] = [
  {
    accountId: "capital",
    code: "3001",
    name: "Capital",
    type: "equity",
    parentName: null,
    active: true,
  },
  {
    accountId: "unused",
    code: "2001",
    name: "Unused",
    type: "liability",
    parentName: null,
    active: true,
  },
  {
    accountId: "cash",
    code: "1001",
    name: "Cash",
    type: "asset",
    parentName: "Cash",
    active: false,
  },
  {
    accountId: "expense",
    code: "6001",
    name: "Discount",
    type: "expense",
    parentName: null,
    active: true,
  },
  {
    accountId: "clearing",
    code: "1200",
    name: "Clearing",
    type: "asset",
    parentName: null,
    active: true,
  },
];

const opening = [
  { accountId: "cash", debitPaise: 50_000n, creditPaise: 0n },
  { accountId: "capital", debitPaise: 0n, creditPaise: 50_000n },
];

const period = [
  { accountId: "cash", debitPaise: 4_000n, creditPaise: 500n },
  { accountId: "expense", debitPaise: 500n, creditPaise: 0n },
  { accountId: "capital", debitPaise: 0n, creditPaise: 4_000n },
  { accountId: "clearing", debitPaise: 100n, creditPaise: 100n },
];

test("trial balance nets opening and closing, keeps activity and inactive leaves, and sorts by code", () => {
  const { rows, totals } = buildTrialBalance(accounts, opening, period);

  expect(rows.map(({ code }) => code)).toEqual(["1001", "1200", "3001", "6001"]);
  expect(rows[0]).toMatchObject({
    active: false,
    openingDebitPaise: 50_000n,
    openingCreditPaise: 0n,
    debitPaise: 4_000n,
    creditPaise: 500n,
    closingDebitPaise: 53_500n,
    closingCreditPaise: 0n,
  });
  expect(rows[1]).toMatchObject({
    debitPaise: 100n,
    creditPaise: 100n,
    closingDebitPaise: 0n,
    closingCreditPaise: 0n,
  });
  expect(rows[2]).toMatchObject({ openingCreditPaise: 50_000n, closingCreditPaise: 54_000n });
  expect(rows[3]).toMatchObject({
    openingDebitPaise: 0n,
    debitPaise: 500n,
    closingDebitPaise: 500n,
  });
  expect(totals).toEqual({
    openingDebitPaise: 50_000n,
    openingCreditPaise: 50_000n,
    debitPaise: 4_600n,
    creditPaise: 4_600n,
    closingDebitPaise: 54_000n,
    closingCreditPaise: 54_000n,
  });
});

test("trial balance refuses unbalanced journal activity", () => {
  expect(() => buildTrialBalance(accounts, opening, period.slice(1))).toThrow();
});

test("statement trees subtotal nested groups and omit zero leaves and empty groups", () => {
  const chart: StatementAccount[] = [
    { accountId: "income", parentId: null, code: "4000", name: "Income", type: "income" },
    { accountId: "sales", parentId: "income", code: "4100", name: "Sales", type: "income" },
    { accountId: "service", parentId: "sales", code: "4101", name: "Service", type: "income" },
    { accountId: "zero", parentId: "sales", code: "4102", name: "Zero", type: "income" },
    { accountId: "empty", parentId: "income", code: "4200", name: "Empty", type: "income" },
    { accountId: "expense", parentId: null, code: "6000", name: "Expenses", type: "expense" },
    { accountId: "rent", parentId: "expense", code: "6100", name: "Rent", type: "expense" },
  ];

  const activity = [
    { accountId: "service", debitPaise: 0n, creditPaise: 1_000_000n },
    { accountId: "zero", debitPaise: 200n, creditPaise: 200n },
    { accountId: "rent", debitPaise: 350_000n, creditPaise: 0n },
  ];

  expect(buildProfitAndLoss(chart, activity)).toEqual({
    income: [
      {
        accountId: "income",
        code: "4000",
        name: "Income",
        amountPaise: 1_000_000n,
        children: [
          {
            accountId: "sales",
            code: "4100",
            name: "Sales",
            amountPaise: 1_000_000n,
            children: [
              {
                accountId: "service",
                code: "4101",
                name: "Service",
                amountPaise: 1_000_000n,
                children: [],
              },
            ],
          },
        ],
      },
    ],
    expenses: [
      {
        accountId: "expense",
        code: "6000",
        name: "Expenses",
        amountPaise: 350_000n,
        children: [
          {
            accountId: "rent",
            code: "6100",
            name: "Rent",
            amountPaise: 350_000n,
            children: [],
          },
        ],
      },
    ],
    incomePaise: 1_000_000n,
    expensesPaise: 350_000n,
    netProfitPaise: 650_000n,
  });
});

test("balance sheet rolls nested sections up without reclassifying a negative asset", () => {
  const chart: StatementAccount[] = [
    { accountId: "assets", parentId: null, code: "100", name: "Assets", type: "asset" },
    { accountId: "cash", parentId: "assets", code: "101", name: "Cash", type: "asset" },
    { accountId: "bank", parentId: "assets", code: "102", name: "Bank", type: "asset" },
    { accountId: "empty", parentId: "assets", code: "103", name: "Empty", type: "asset" },
    { accountId: "capital", parentId: null, code: "300", name: "Capital", type: "equity" },
    { accountId: "income", parentId: null, code: "400", name: "Income", type: "income" },
    { accountId: "expense", parentId: null, code: "600", name: "Expense", type: "expense" },
  ];

  const through = [
    { accountId: "cash", debitPaise: 10_000n, creditPaise: 0n },
    { accountId: "bank", debitPaise: 0n, creditPaise: 2_000n },
    { accountId: "capital", debitPaise: 0n, creditPaise: 5_000n },
    { accountId: "income", debitPaise: 0n, creditPaise: 4_000n },
    { accountId: "expense", debitPaise: 1_000n, creditPaise: 0n },
  ];

  const currentYear = [
    { accountId: "income", debitPaise: 0n, creditPaise: 2_500n },
    { accountId: "expense", debitPaise: 500n, creditPaise: 0n },
  ];

  expect(buildBalanceSheet(chart, through, currentYear)).toEqual({
    assets: [
      {
        accountId: "assets",
        code: "100",
        name: "Assets",
        amountPaise: 8_000n,
        children: [
          { accountId: "cash", code: "101", name: "Cash", amountPaise: 10_000n, children: [] },
          { accountId: "bank", code: "102", name: "Bank", amountPaise: -2_000n, children: [] },
        ],
      },
    ],
    liabilities: [],
    equity: [
      { accountId: "capital", code: "300", name: "Capital", amountPaise: 5_000n, children: [] },
    ],
    currentYearProfitPaise: 2_000n,
    earlierYearsProfitPaise: 1_000n,
    assetsPaise: 8_000n,
    liabilitiesPaise: 0n,
    equityPaise: 8_000n,
  });
});

test("balance sheet rejects journal activity that breaks the accounting equation", () => {
  const chart: StatementAccount[] = [
    { accountId: "cash", parentId: null, code: "1001", name: "Cash", type: "asset" },
    { accountId: "capital", parentId: null, code: "3001", name: "Capital", type: "equity" },
  ];

  const unbalanced = [{ accountId: "cash", debitPaise: 100n, creditPaise: 0n }];

  expect(() => buildBalanceSheet(chart, unbalanced, [])).toThrow("balance sheet does not balance");
});
