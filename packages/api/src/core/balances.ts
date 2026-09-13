import type { DbTransaction } from "@accly/db/counter";
import { balances } from "@accly/db/schema/balances";
import { sql } from "drizzle-orm";

import { monthOf } from "./numbering";
import type { JournalLineInput } from "./posting";

export async function applyBalances(
  tx: DbTransaction,
  orgId: string,
  entryDate: string,
  lines: readonly JournalLineInput[],
): Promise<void> {
  const totals = new Map<string, { debit: bigint; credit: bigint }>();

  for (const line of lines) {
    const total = totals.get(line.accountId) ?? { debit: 0n, credit: 0n };
    total.debit += line.debit;
    total.credit += line.credit;
    totals.set(line.accountId, total);
  }

  const month = monthOf(entryDate);

  // Sorted, so concurrent posts and cancels lock balance rows in one order and cannot
  // deadlock each other.
  const values = [...totals]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([accountId, total]) => ({
      orgId,
      accountId,
      month,
      debit: total.debit,
      credit: total.credit,
    }));

  await tx
    .insert(balances)
    .values(values)
    .onConflictDoUpdate({
      target: [balances.orgId, balances.accountId, balances.month],
      set: {
        debit: sql`${balances.debit} + excluded.debit`,
        credit: sql`${balances.credit} + excluded.credit`,
        version: sql`${balances.version} + 1`,
      },
    });
}
