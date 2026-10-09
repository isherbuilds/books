import type { AccountType } from "@accly/db/schema/account-kinds";
import type { EntryDocumentType } from "@accly/db/schema/journal-entries";

import { impossible } from "../lib/conflict";
import type { AccountActivity, ReportHeader } from "../lib/reports";

export type TrialBalanceAccount = {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  parentName: string | null;
  active: boolean;
};

export type TrialBalanceTotals = {
  openingDebitPaise: bigint;
  openingCreditPaise: bigint;
  debitPaise: bigint;
  creditPaise: bigint;
  closingDebitPaise: bigint;
  closingCreditPaise: bigint;
};

export type TrialBalanceRow = TrialBalanceAccount & TrialBalanceTotals;

export function buildTrialBalance(
  accounts: TrialBalanceAccount[],
  opening: AccountActivity[],
  period: AccountActivity[],
): { rows: TrialBalanceRow[]; totals: TrialBalanceTotals } {
  const openingByAccount = new Map(opening.map((row) => [row.accountId, row]));
  const periodByAccount = new Map(period.map((row) => [row.accountId, row]));

  const totals: TrialBalanceTotals = {
    openingDebitPaise: 0n,
    openingCreditPaise: 0n,
    debitPaise: 0n,
    creditPaise: 0n,
    closingDebitPaise: 0n,
    closingCreditPaise: 0n,
  };

  const rows: TrialBalanceRow[] = [];

  for (const account of accounts) {
    const before = openingByAccount.get(account.accountId);
    const activity = periodByAccount.get(account.accountId);
    const openingPaise = (before?.debitPaise ?? 0n) - (before?.creditPaise ?? 0n);
    const debitPaise = activity?.debitPaise ?? 0n;
    const creditPaise = activity?.creditPaise ?? 0n;

    if (openingPaise === 0n && debitPaise === 0n && creditPaise === 0n) continue;

    const closingPaise = openingPaise + debitPaise - creditPaise;

    const amounts = {
      openingDebitPaise: openingPaise > 0n ? openingPaise : 0n,
      openingCreditPaise: openingPaise < 0n ? -openingPaise : 0n,
      debitPaise,
      creditPaise,
      closingDebitPaise: closingPaise > 0n ? closingPaise : 0n,
      closingCreditPaise: closingPaise < 0n ? -closingPaise : 0n,
    };

    rows.push({ ...account, ...amounts });
    totals.openingDebitPaise += amounts.openingDebitPaise;
    totals.openingCreditPaise += amounts.openingCreditPaise;
    totals.debitPaise += debitPaise;
    totals.creditPaise += creditPaise;
    totals.closingDebitPaise += amounts.closingDebitPaise;
    totals.closingCreditPaise += amounts.closingCreditPaise;
  }

  if (
    totals.openingDebitPaise !== totals.openingCreditPaise ||
    totals.debitPaise !== totals.creditPaise ||
    totals.closingDebitPaise !== totals.closingCreditPaise
  ) {
    throw impossible("trial balance totals do not balance");
  }

  rows.sort((left, right) => left.code.localeCompare(right.code, "en"));

  return { rows, totals };
}

export type StatementAccount = {
  accountId: string;
  parentId: string | null;
  code: string;
  name: string;
  type: AccountType;
};

export type StatementNode = {
  accountId: string;
  code: string;
  name: string;
  amountPaise: bigint;
  children: StatementNode[];
};

export type ProfitAndLoss = {
  income: StatementNode[];
  expenses: StatementNode[];
  incomePaise: bigint;
  expensesPaise: bigint;
  netProfitPaise: bigint;
};

export type BalanceSheet = {
  assets: StatementNode[];
  liabilities: StatementNode[];
  equity: StatementNode[];
  currentYearProfitPaise: bigint;
  earlierYearsProfitPaise: bigint;
  assetsPaise: bigint;
  liabilitiesPaise: bigint;
  equityPaise: bigint;
};

export type ProfitAndLossReport = { header: ReportHeader } & ProfitAndLoss;

export type BalanceSheetReport = { header: ReportHeader } & BalanceSheet;

export type AccountLedgerLine = {
  id: string;
  entryId: string;
  entryDate: string;
  kind: "post" | "reverse";
  documentId: string;
  documentType: EntryDocumentType;
  number: string | null;
  narration: string;
  partyName: string | null;
  contraAccountName: string | null;
  debitPaise: bigint;
  creditPaise: bigint;
  balancePaise: bigint;
};

export type AccountLedgerReport = {
  header: ReportHeader;
  account: { id: string; code: string; name: string; type: AccountType; active: boolean };
  openingPaise: bigint;
  lines: AccountLedgerLine[];
  closingPaise: bigint;
};

export type DayBookEntry = {
  entryId: string;
  entryDate: string;
  kind: "post" | "reverse";
  documentId: string;
  documentType: EntryDocumentType;
  number: string | null;
  narration: string;
  lines: Array<{
    accountCode: string;
    accountName: string;
    partyName: string | null;
    debitPaise: bigint;
    creditPaise: bigint;
  }>;
};

export type DayBookReport = {
  header: ReportHeader;
  entries: DayBookEntry[];
  debitPaise: bigint;
  creditPaise: bigint;
};

function statementTree(
  accounts: StatementAccount[],
  activity: AccountActivity[],
  type: AccountType,
): StatementNode[] {
  const amounts = new Map(
    activity.map((row) => [
      row.accountId,
      type === "asset" || type === "expense"
        ? row.debitPaise - row.creditPaise
        : row.creditPaise - row.debitPaise,
    ]),
  );

  const children = new Map<string | null, StatementAccount[]>();

  for (const account of accounts) {
    if (account.type !== type) continue;
    const siblings = children.get(account.parentId) ?? [];
    siblings.push(account);
    children.set(account.parentId, siblings);
  }

  function branch(parentId: string | null): StatementNode[] {
    return (children.get(parentId) ?? [])
      .map((account) => {
        const descendants = branch(account.accountId);

        const amountPaise =
          (amounts.get(account.accountId) ?? 0n) +
          descendants.reduce((sum, child) => sum + child.amountPaise, 0n);

        return {
          accountId: account.accountId,
          code: account.code,
          name: account.name,
          amountPaise,
          children: descendants,
        };
      })
      .filter((node) => node.amountPaise !== 0n || node.children.length > 0)
      .sort((left, right) => left.code.localeCompare(right.code, "en"));
  }

  return branch(null);
}

function sectionTotal(nodes: StatementNode[]): bigint {
  return nodes.reduce((sum, node) => sum + node.amountPaise, 0n);
}

function netProfitPaise(types: Map<string, AccountType>, activity: AccountActivity[]): bigint {
  return activity.reduce(
    (total, row) =>
      types.get(row.accountId) === "income" || types.get(row.accountId) === "expense"
        ? total + row.creditPaise - row.debitPaise
        : total,
    0n,
  );
}

export function buildProfitAndLoss(
  accounts: StatementAccount[],
  activity: AccountActivity[],
): ProfitAndLoss {
  const income = statementTree(accounts, activity, "income");
  const expenses = statementTree(accounts, activity, "expense");
  const incomePaise = sectionTotal(income);
  const expensesPaise = sectionTotal(expenses);

  return {
    income,
    expenses,
    incomePaise,
    expensesPaise,
    netProfitPaise: incomePaise - expensesPaise,
  };
}

export function buildBalanceSheet(
  accounts: StatementAccount[],
  through: AccountActivity[],
  currentYear: AccountActivity[],
): BalanceSheet {
  const assets = statementTree(accounts, through, "asset");
  const liabilities = statementTree(accounts, through, "liability");
  const equity = statementTree(accounts, through, "equity");
  const types = new Map(accounts.map(({ accountId, type }) => [accountId, type]));
  const currentYearProfitPaise = netProfitPaise(types, currentYear);
  const accumulatedProfitPaise = netProfitPaise(types, through);
  const earlierYearsProfitPaise = accumulatedProfitPaise - currentYearProfitPaise;
  const assetsPaise = sectionTotal(assets);
  const liabilitiesPaise = sectionTotal(liabilities);
  const equityPaise = sectionTotal(equity) + currentYearProfitPaise + earlierYearsProfitPaise;

  if (assetsPaise !== liabilitiesPaise + equityPaise) {
    throw impossible("balance sheet does not balance");
  }

  return {
    assets,
    liabilities,
    equity,
    currentYearProfitPaise,
    earlierYearsProfitPaise,
    assetsPaise,
    liabilitiesPaise,
    equityPaise,
  };
}
