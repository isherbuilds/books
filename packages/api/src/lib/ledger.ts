// Journal dates follow the organization's configured time zone.
import { and, eq, isNotNull } from "drizzle-orm";

import type { DbTransaction } from "@accly/db/counter";
import { accounts, type AccountType } from "@accly/db/schema/accounts";
import type { ItemCategory } from "@accly/db/schema/items";
import { journalEntries } from "@accly/db/schema/journal-entries";
import { journalLines } from "@accly/db/schema/journal-lines";

import { formatDecimal as formatMoney } from "../core/money";
import { businessDate } from "./business-date";

const SYSTEM_ACCOUNTS = [
  { key: "cash", code: "1000", name: "Cash in Hand", type: "asset" },
  { key: "bank", code: "1100", name: "Bank", type: "asset" },
  {
    key: "customer_receivables",
    code: "1200",
    name: "Customer Receivables",
    type: "asset",
  },
  {
    key: "gst_output",
    code: "2100",
    name: "GST Output Payable",
    type: "liability",
  },
  {
    key: "revenue_consultation",
    code: "4100",
    name: "Consultation Revenue",
    type: "income",
  },
  {
    key: "revenue_procedure",
    code: "4200",
    name: "Procedure Revenue",
    type: "income",
  },
  { key: "revenue_lab", code: "4300", name: "Lab Revenue", type: "income" },
  {
    key: "revenue_radiology",
    code: "4400",
    name: "Radiology Revenue",
    type: "income",
  },
  { key: "revenue_other", code: "4900", name: "Other Revenue", type: "income" },
] as const satisfies ReadonlyArray<{
  key: string;
  code: string;
  name: string;
  type: AccountType;
}>;

export type SystemAccountKey = (typeof SYSTEM_ACCOUNTS)[number]["key"];

function isSystemAccountKey(value: string): value is SystemAccountKey {
  return SYSTEM_ACCOUNTS.some((account) => account.key === value);
}

const REVENUE_ACCOUNTS: Record<ItemCategory, SystemAccountKey> = {
  consultation: "revenue_consultation",
  procedure: "revenue_procedure",
  lab: "revenue_lab",
  radiology: "revenue_radiology",
  other: "revenue_other",
};

export function revenueAccountFor(category: ItemCategory): SystemAccountKey {
  return REVENUE_ACCOUNTS[category];
}

export function settlementAccountFor(method: string): SystemAccountKey {
  switch (method) {
    case "cash":
      return "cash";
    case "upi":
    case "card":
    case "bank":
      return "bank";
    default:
      throw new Error(`Unsupported settlement method: ${method}`);
  }
}

async function ensureChartOfAccounts(
  tx: DbTransaction,
  orgId: string,
): Promise<Record<SystemAccountKey, string>> {
  const existing = await tx
    .select({ id: accounts.id, systemKey: accounts.systemKey })
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), isNotNull(accounts.systemKey)));

  const accountIds = new Map<SystemAccountKey, string>();

  for (const row of existing) {
    if (row.systemKey !== null && isSystemAccountKey(row.systemKey)) {
      accountIds.set(row.systemKey, row.id);
    }
  }

  const missing = SYSTEM_ACCOUNTS.filter((account) => !accountIds.has(account.key));

  if (missing.length > 0) {
    await tx
      .insert(accounts)
      .values(
        missing.map((account) => ({
          id: Bun.randomUUIDv7(),
          orgId,
          code: account.code,
          name: account.name,
          type: account.type,
          systemKey: account.key,
        })),
      )
      .onConflictDoNothing({ target: [accounts.orgId, accounts.code] });

    const resolved = await tx
      .select({ id: accounts.id, systemKey: accounts.systemKey })
      .from(accounts)
      .where(and(eq(accounts.orgId, orgId), isNotNull(accounts.systemKey)));

    for (const row of resolved) {
      if (row.systemKey !== null && isSystemAccountKey(row.systemKey)) {
        accountIds.set(row.systemKey, row.id);
      }
    }
  }

  // SAFETY: The loop below fills each system key and throws before return if any is missing.
  const complete = {} as Record<SystemAccountKey, string>;

  for (const account of SYSTEM_ACCOUNTS) {
    const id = accountIds.get(account.key);

    if (id === undefined) {
      throw new Error(`System account could not be resolved: ${account.key}`);
    }

    complete[account.key] = id;
  }

  return complete;
}

type JournalLineInput = {
  account: SystemAccountKey;
  debit?: bigint;
  credit?: bigint;
};

export async function postJournalEntry(
  tx: DbTransaction,
  args: {
    orgId: string;
    sourceType: string;
    sourceId: string;
    narration: string;
    createdBy: string;
    lines: JournalLineInput[];
    now: Date;
    timeZone: string;
  },
): Promise<void> {
  const preparedLines: Array<{
    account: SystemAccountKey;
    debit: bigint;
    credit: bigint;
  }> = [];

  let debitTotal = 0n;
  let creditTotal = 0n;

  for (const line of args.lines) {
    const hasDebit = line.debit !== undefined;
    const hasCredit = line.credit !== undefined;

    if (hasDebit === hasCredit) {
      throw new Error(`Journal line for ${line.account} must set exactly one side`);
    }

    const debit = line.debit ?? 0n;
    const credit = line.credit ?? 0n;

    if (debit === 0n && credit === 0n) {
      continue;
    }

    debitTotal += debit;
    creditTotal += credit;
    preparedLines.push({ account: line.account, debit, credit });
  }

  if (preparedLines.length === 0) {
    throw new Error("Journal entry must contain at least one non-zero line");
  }

  if (debitTotal !== creditTotal) {
    throw new Error(
      `Journal entry is imbalanced: debit ${formatMoney(debitTotal)}, credit ${formatMoney(creditTotal)}`,
    );
  }

  const accountIds = await ensureChartOfAccounts(tx, args.orgId);
  const entryId = Bun.randomUUIDv7();
  await tx.insert(journalEntries).values({
    id: entryId,
    orgId: args.orgId,
    entryDate: businessDate(args.now, args.timeZone),
    documentType: args.sourceType,
    documentId: args.sourceId,
    kind: "post",
    narration: args.narration,
    createdBy: args.createdBy,
  });
  await tx.insert(journalLines).values(
    preparedLines.map((line) => ({
      id: Bun.randomUUIDv7(),
      orgId: args.orgId,
      entryId,
      accountId: accountIds[line.account],
      debit: line.debit,
      credit: line.credit,
    })),
  );
}
