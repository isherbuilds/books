import { db, type DbTransaction } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { DOCUMENT_TYPES } from "@accly/db/schema/documents";
import { journalEntries } from "@accly/db/schema/journal-entries";
import { journalLines } from "@accly/db/schema/journal-lines";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import {
  buildBalanceSheet,
  buildProfitAndLoss,
  buildTrialBalance,
  type AccountLedgerReport,
  type BalanceSheetReport,
  type DayBookEntry,
  type DayBookReport,
  type ProfitAndLossReport,
  type StatementAccount,
  type TrialBalanceAccount,
} from "../core/reports";
import { isLeaf } from "../lib/accounts";
import { financialYearStartYear } from "../lib/business-date";
import { badRequest, impossible } from "../lib/conflict";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import {
  accountActivity,
  accountActivitySince,
  accountLedgerLines,
  accountLedgerProbe,
  assertReportFits,
  afterCursor,
  dayBookLines,
  headerFromProfile,
  reportHeader,
  reportProfile,
  reportTooLarge,
} from "../lib/reports";
import { pageOf } from "../lib/settlements";
import { dateOnly, ledgerCursor, orderedPeriod, pageLimit } from "../lib/schemas";

const parent = alias(accounts, "report_parent");

export const periodInput = orgInput
  .extend({ from: dateOnly, to: dateOnly })
  .superRefine(orderedPeriod);

export const ledgerInput = orgInput
  .extend({ accountId: z.uuid(), from: dateOnly, to: dateOnly })
  .superRefine(orderedPeriod);

export const dayBookInput = orgInput
  .extend({
    from: dateOnly,
    to: dateOnly,
    documentType: z.enum([...DOCUMENT_TYPES, "allocation"]).optional(),
  })
  .superRefine(orderedPeriod);

type DayBookFilter = {
  from: string;
  to: string;
  documentType?: (typeof DOCUMENT_TYPES)[number] | "allocation";
};

export async function trialBalance(orgId: string, period: { from: string; to: string }) {
  return db.transaction(
    async (tx) => {
      const accountsInChart: TrialBalanceAccount[] = await tx
        .select({
          accountId: accounts.id,
          code: accounts.code,
          name: accounts.name,
          type: accounts.type,
          parentName: parent.name,
          active: accounts.active,
        })
        .from(accounts)
        .leftJoin(parent, and(eq(parent.orgId, orgId), eq(parent.id, accounts.parentId)))
        .where(and(eq(accounts.orgId, orgId), isLeaf(orgId)));

      const through = await accountActivitySince(
        orgId,
        { through: period.to, since: period.from },
        tx,
      );

      const opening = through.map(
        ({ accountId, debitPaise, creditPaise, sinceDebitPaise, sinceCreditPaise }) => ({
          accountId,
          debitPaise: debitPaise - sinceDebitPaise,
          creditPaise: creditPaise - sinceCreditPaise,
        }),
      );

      const activity = through.map(({ accountId, sinceDebitPaise, sinceCreditPaise }) => ({
        accountId,
        debitPaise: sinceDebitPaise,
        creditPaise: sinceCreditPaise,
      }));

      const header = await reportHeader(orgId, period, tx);

      return { header, ...buildTrialBalance(accountsInChart, opening, activity) };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

async function statementAccounts(orgId: string, tx: DbTransaction): Promise<StatementAccount[]> {
  return tx
    .select({
      accountId: accounts.id,
      parentId: accounts.parentId,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
    })
    .from(accounts)
    .where(eq(accounts.orgId, orgId));
}

export async function profitAndLoss(
  orgId: string,
  period: { from: string; to: string },
): Promise<ProfitAndLossReport> {
  return db.transaction(
    async (tx) => {
      const chart = await statementAccounts(orgId, tx);

      const activity = await accountActivity(orgId, period, tx);
      const header = await reportHeader(orgId, period, tx);

      return { header, ...buildProfitAndLoss(chart, activity) };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export async function balanceSheet(orgId: string, asOf: string): Promise<BalanceSheetReport> {
  return db.transaction(
    async (tx) => {
      const profile = await reportProfile(orgId, tx);
      const header = headerFromProfile(profile, { asOf });
      const startYear = financialYearStartYear(asOf, profile.financialYearStart);
      const from = `${startYear}-${String(profile.financialYearStart).padStart(2, "0")}-01`;

      const chart = await statementAccounts(orgId, tx);

      const activity = await accountActivitySince(orgId, { through: asOf, since: from }, tx);

      const through = activity.map(({ accountId, debitPaise, creditPaise }) => ({
        accountId,
        debitPaise,
        creditPaise,
      }));

      const currentYear = activity.map(({ accountId, sinceDebitPaise, sinceCreditPaise }) => ({
        accountId,
        debitPaise: sinceDebitPaise,
        creditPaise: sinceCreditPaise,
      }));

      return { header, ...buildBalanceSheet(chart, through, currentYear) };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

async function postingAccount(
  orgId: string,
  accountId: string,
  executor: typeof db | DbTransaction = db,
) {
  const [account] = await executor
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      active: accounts.active,
      leaf: isLeaf(orgId),
    })
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), eq(accounts.id, accountId)))
    .limit(1);

  if (!account) throw new ORPCError("NOT_FOUND");

  if (!account.leaf) throw badRequest("ACCOUNT_INVALID", "Choose a posting account, not a group.");

  const { leaf: _leaf, ...posting } = account;

  return posting;
}

// An allocation has no number of its own; a reversal names what it reverses.
function ledgerLabel<
  T extends { documentType: string; number: string | null; narration: string; kind: string },
>(row: T): T {
  if (row.documentType === "allocation") return { ...row, number: null, narration: "Allocation" };

  if (row.kind === "reverse")
    return { ...row, narration: `Reversal of ${row.number ?? row.narration}` };

  return row;
}

export async function accountLedger(
  orgId: string,
  input: { accountId: string; from: string; to: string },
  limit: number,
): Promise<AccountLedgerReport> {
  return db.transaction(
    async (tx) => {
      const account = await postingAccount(orgId, input.accountId, tx);

      // The probe and the read share this snapshot, so the read cannot pass `limit`.
      await assertReportFits(accountLedgerProbe(orgId, input, tx), limit);

      const detail = await accountLedgerLines(orgId, input, limit, tx);

      const [opening] = await accountActivity(orgId, { before: input.from }, tx, account.id);
      const openingPaise = (opening?.debitPaise ?? 0n) - (opening?.creditPaise ?? 0n);
      let balancePaise = openingPaise;

      const lines = detail.map((row) => {
        balancePaise += row.debitPaise - row.creditPaise;

        return { ...ledgerLabel(row), balancePaise };
      });

      const header = await reportHeader(orgId, { from: input.from, to: input.to }, tx);

      return { header, account, openingPaise, lines, closingPaise: balancePaise };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

// One selected journal line with its entry's fields, as `dayBookLines` returns it.
type DayBookLine = Omit<DayBookEntry, "lines"> & DayBookEntry["lines"][number];

// Consecutive lines of one entry become that entry, in line order.
function groupDayBook(detail: DayBookLine[]) {
  const entries: DayBookEntry[] = [];
  let debitPaise = 0n;
  let creditPaise = 0n;

  for (const row of detail) {
    let entry = entries.at(-1);

    if (entry?.entryId !== row.entryId) {
      const { number, narration } = ledgerLabel(row);
      entry = {
        entryId: row.entryId,
        entryDate: row.entryDate,
        kind: row.kind,
        documentId: row.documentId,
        documentType: row.documentType,
        number,
        narration,
        lines: [],
      };
      entries.push(entry);
    }

    entry.lines.push({
      accountCode: row.accountCode,
      accountName: row.accountName,
      partyName: row.partyName,
      debitPaise: row.debitPaise,
      creditPaise: row.creditPaise,
    });
    debitPaise += row.debitPaise;
    creditPaise += row.creditPaise;
  }

  return { entries, debitPaise, creditPaise };
}

export async function dayBook(
  orgId: string,
  input: DayBookFilter,
  limit: number,
): Promise<DayBookReport> {
  return db.transaction(
    async (tx) => {
      const detail = await dayBookLines(orgId, input, limit, tx);

      if (detail.length > limit) throw reportTooLarge(limit);
      const { entries, debitPaise, creditPaise } = groupDayBook(detail);

      const header = await reportHeader(orgId, { from: input.from, to: input.to }, tx);

      return { header, entries, debitPaise, creditPaise };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

// One keyset page oldest first, without balances: pages load contiguously from
// page one, so the client runs the balance from `accountLedgerSummary.openingPaise`
// instead of the server summing every earlier line for each page.
async function accountLedgerPage(
  orgId: string,
  input: {
    accountId: string;
    from: string;
    to: string;
    cursor?: z.infer<typeof ledgerCursor>;
    limit: number;
  },
) {
  const [, detail] = await Promise.all([
    postingAccount(orgId, input.accountId),
    accountLedgerLines(orgId, input, input.limit),
  ]);

  const { rows, hasMore } = pageOf(detail, input.limit);

  return { rows: rows.map(ledgerLabel), hasMore };
}

async function accountLedgerSummary(
  orgId: string,
  input: { accountId: string; from: string; to: string },
) {
  const inPeriod = gte(journalLines.entryDate, input.from);

  const [account, [amounts]] = await Promise.all([
    postingAccount(orgId, input.accountId),
    db
      .select({
        openingPaise:
          sql<bigint>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}) filter (where ${journalLines.entryDate} < ${input.from}), 0)::bigint`.mapWith(
            BigInt,
          ),
        debitPaise:
          sql<bigint>`coalesce(sum(${journalLines.debit}) filter (where ${inPeriod}), 0)::bigint`.mapWith(
            BigInt,
          ),
        creditPaise:
          sql<bigint>`coalesce(sum(${journalLines.credit}) filter (where ${inPeriod}), 0)::bigint`.mapWith(
            BigInt,
          ),
      })
      .from(journalLines)
      .where(
        and(
          eq(journalLines.orgId, orgId),
          eq(journalLines.accountId, input.accountId),
          lte(journalLines.entryDate, input.to),
        ),
      ),
  ]);

  if (!amounts) throw impossible("aggregate returned no row");
  const { openingPaise, debitPaise, creditPaise } = amounts;

  return {
    account,
    openingPaise,
    debitPaise,
    creditPaise,
    closingPaise: openingPaise + debitPaise - creditPaise,
  };
}

// Pages whole entries: the page's entry ids first, then their lines.
async function dayBookPage(
  orgId: string,
  input: DayBookFilter & { cursor?: z.infer<typeof ledgerCursor>; limit: number },
) {
  return db.transaction(
    async (tx) => {
      const ids = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.orgId, orgId),
            gte(journalEntries.entryDate, input.from),
            lte(journalEntries.entryDate, input.to),
            input.documentType ? eq(journalEntries.documentType, input.documentType) : undefined,
            input.cursor
              ? afterCursor(journalEntries.entryDate, journalEntries.id, input.cursor)
              : undefined,
          ),
        )
        .orderBy(asc(journalEntries.entryDate), asc(journalEntries.id))
        .limit(input.limit + 1);

      const { rows, hasMore } = pageOf(ids, input.limit);

      if (rows.length === 0) return { rows: [], hasMore };

      const detail = await dayBookLines(
        orgId,
        { ...input, entryIds: rows.map((row) => row.id) },
        undefined,
        tx,
      );

      return { rows: groupDayBook(detail).entries, hasMore };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

// The scalar entry count and monetary sums share one PostgreSQL snapshot.
async function dayBookSummary(orgId: string, input: DayBookFilter) {
  const entries = and(
    eq(journalEntries.orgId, orgId),
    gte(journalEntries.entryDate, input.from),
    lte(journalEntries.entryDate, input.to),
    input.documentType ? eq(journalEntries.documentType, input.documentType) : undefined,
  );

  const [summary] = await db
    .select({
      entryCount:
        sql<number>`(select count(*)::integer from ${journalEntries} where ${entries})`.mapWith(
          Number,
        ),
      debitPaise: sql<bigint>`coalesce(sum(${journalLines.debit}), 0)::bigint`.mapWith(BigInt),
      creditPaise: sql<bigint>`coalesce(sum(${journalLines.credit}), 0)::bigint`.mapWith(BigInt),
    })
    .from(journalLines)
    .where(
      and(
        eq(journalLines.orgId, orgId),
        gte(journalLines.entryDate, input.from),
        lte(journalLines.entryDate, input.to),
        input.documentType
          ? inArray(
              journalLines.entryId,
              db.select({ id: journalEntries.id }).from(journalEntries).where(entries),
            )
          : undefined,
      ),
    );

  if (!summary) throw impossible("aggregate returned no row");

  return summary;
}

export const reportRouter = {
  trialBalance: orgProcedure({ report: ["readFinancial"] }, periodInput).handler(
    ({ context, input }) => trialBalance(context.scope.orgId, { from: input.from, to: input.to }),
  ),
  profitAndLoss: orgProcedure({ report: ["readFinancial"] }, periodInput).handler(
    ({ context, input }) => profitAndLoss(context.scope.orgId, { from: input.from, to: input.to }),
  ),
  balanceSheet: orgProcedure(
    { report: ["readFinancial"] },
    orgInput.extend({ asOf: dateOnly }),
  ).handler(({ context, input }) => balanceSheet(context.scope.orgId, input.asOf)),
  accountLedger: orgProcedure({ report: ["readFinancial"] }, ledgerInput).handler(
    ({ context, input }) =>
      accountLedger(
        context.scope.orgId,
        { accountId: input.accountId, from: input.from, to: input.to },
        5_000,
      ),
  ),
  accountLedgerLines: orgProcedure(
    { report: ["readFinancial"] },
    ledgerInput.safeExtend({ cursor: ledgerCursor.optional(), limit: pageLimit }),
  ).handler(({ context, input }) => accountLedgerPage(context.scope.orgId, input)),
  accountLedgerSummary: orgProcedure({ report: ["readFinancial"] }, ledgerInput).handler(
    ({ context, input }) => accountLedgerSummary(context.scope.orgId, input),
  ),
  dayBook: orgProcedure({ report: ["readFinancial"] }, dayBookInput).handler(({ context, input }) =>
    dayBook(
      context.scope.orgId,
      { from: input.from, to: input.to, documentType: input.documentType },
      5_000,
    ),
  ),
  dayBookEntries: orgProcedure(
    { report: ["readFinancial"] },
    dayBookInput.safeExtend({ cursor: ledgerCursor.optional(), limit: pageLimit }),
  ).handler(({ context, input }) => dayBookPage(context.scope.orgId, input)),
  dayBookSummary: orgProcedure({ report: ["readFinancial"] }, dayBookInput).handler(
    ({ context, input }) => dayBookSummary(context.scope.orgId, input),
  ),
};
