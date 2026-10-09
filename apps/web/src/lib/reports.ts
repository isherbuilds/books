import { formatBalance } from "@accly/api/core/money";
import type { AppRouterClient } from "@accly/api/routers/index";

import { nextPage, orpc } from "@/lib/orpc";

/** Each row with the balance after it, from the opening balance and each row's change. */
export function withRunningBalance<Row>(
  openingPaise: bigint,
  rows: readonly Row[],
  changePaise: (row: Row) => bigint,
) {
  let balancePaise = openingPaise;

  return rows.map((row) => {
    balancePaise += changePaise(row);

    return { ...row, balancePaise };
  });
}

/** An account ledger line's change: debits raise the balance, credits lower it. */
export const netDebitPaise = (row: { debitPaise: bigint; creditPaise: bigint }) =>
  row.debitPaise - row.creditPaise;

/** What a line settled before TDS was deducted from it. */
export const grossOfTdsPaise = (netPaise: bigint, tdsPaise: bigint) => netPaise + tdsPaise;

export function formatSideBalance(debitPaise: bigint, creditPaise: bigint): string {
  return formatBalance(debitPaise - creditPaise);
}

// The server returns the workbook as a File; a detached anchor saves it under the
// name the server chose. The object URL is released after the download has started.
export function saveFile(file: File) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Period = { from: string; to: string };

export const trialBalanceOptions = (orgSlug: string, period: Period) =>
  orpc.report.trialBalance.queryOptions({ input: { orgSlug, ...period } });

export const profitAndLossOptions = (orgSlug: string, period: Period) =>
  orpc.report.profitAndLoss.queryOptions({ input: { orgSlug, ...period } });

export const balanceSheetOptions = (orgSlug: string, asOf: string) =>
  orpc.report.balanceSheet.queryOptions({ input: { orgSlug, asOf } });

export type DayBookInput = Omit<
  Parameters<AppRouterClient["report"]["dayBookEntries"]>[0],
  "cursor" | "limit"
>;

export const dayBookSummaryOptions = (input: DayBookInput) =>
  orpc.report.dayBookSummary.queryOptions({ input });

export const dayBookEntriesOptions = (input: DayBookInput) =>
  orpc.report.dayBookEntries.infiniteOptions({
    input: (cursor: { entryDate: string; id: string } | undefined) => ({ ...input, cursor }),
    ...nextPage,
  });

export type AccountLedgerInput = Period & { orgSlug: string; accountId: string };

export const accountLedgerSummaryOptions = (input: AccountLedgerInput) =>
  orpc.report.accountLedgerSummary.queryOptions({ input });

export const accountLedgerLinesOptions = (input: AccountLedgerInput) =>
  orpc.report.accountLedgerLines.infiniteOptions({
    input: (cursor: { entryDate: string; id: string } | undefined) => ({ ...input, cursor }),
    ...nextPage,
  });
