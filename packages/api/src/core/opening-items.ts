import type { db, DbTransaction } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { documents } from "@accly/db/schema/documents";
import type { EntrySide } from "@accly/db/schema/entry-sides";
import type { organizationSettings } from "@accly/db/schema/organization-settings";
import { partyLedgerLines } from "@accly/db/schema/party-ledger-lines";
import { ORPCError } from "@orpc/server";
import { and, eq, inArray } from "drizzle-orm";

import { impossible } from "../lib/conflict";
import { insertChunks } from "../lib/insert-chunks";
import type { Scope } from "../lib/procedures/factory";
import { activeAllocationsOf, lockDocuments } from "./allocations";
import { postedNumber, reverseDocument } from "./documents";
import { postEntryLines } from "./entry-lines";
import { financialYearOf, reserveNumbers } from "./numbering";
import { reversePartyLedgerLines } from "./party-ledger";

export const OPENING_BALANCE_PREFIX = "OB";

const OPENING_ITEM_TYPES = ["openingClaim", "openingCredit"] as const;

// Fixed prefixes: each type keys its own number series.
const OPENING_ITEM_PREFIX = { openingClaim: "OC", openingCredit: "OA" } as const;

export type OpeningItem = {
  partyId: string;
  side: "receivable" | "payable";
  type: (typeof OPENING_ITEM_TYPES)[number];
  reference: string;
  /** The legacy document's date, on or before the cutover. */
  documentDate: string;
  dueDate: string | null;
  amountPaise: bigint;
};

export type OpeningLine = { accountId: string; side: EntrySide; amount: bigint };

/** An item's signed party exposure: a receivable claim adds, a payable claim subtracts. */
function exposurePaise(item: Pick<OpeningItem, "side" | "type" | "amountPaise">): bigint {
  const claim = item.type === "openingClaim";

  return (item.side === "receivable") === claim ? item.amountPaise : -item.amountPaise;
}

/**
 * Each control's net from the items, claims less credits: receivables a debit when
 * positive, payables a credit when positive.
 */
export function controlNets(items: readonly Pick<OpeningItem, "side" | "type" | "amountPaise">[]) {
  let receivablesPaise = 0n;
  let payablesPaise = 0n;

  for (const item of items)
    if (item.side === "receivable") receivablesPaise += exposurePaise(item);
    else payablesPaise -= exposurePaise(item);

  return { receivablesPaise, payablesPaise };
}

/** Refuses a second Opening Balance while one is posted. */
export async function assertNoOpeningBalance(
  tx: DbTransaction | typeof db,
  orgId: string,
): Promise<void> {
  const [existing] = await tx
    .select({ id: documents.id, number: documents.number })
    .from(documents)
    .where(
      and(
        eq(documents.orgId, orgId),
        eq(documents.type, "openingBalance"),
        eq(documents.state, "posted"),
      ),
    )
    .limit(1);

  // The partial unique index remains the final guarantee if another write path is added.
  if (existing)
    throw new ORPCError("CONFLICT", {
      message: `Opening balance ${postedNumber(existing.number, existing.id)} is already posted. Cancel it first.`,
    });
}

/**
 * Posts the Opening Balance with the control legs its items derive, then the items:
 * each a numbered document with one party ledger `post` line dated the cutover, so
 * party statements sum to the controls on every date. The caller holds settings
 * FOR UPDATE and has refused a posted Opening Balance.
 */
export async function postOpening(
  tx: DbTransaction,
  scope: Scope,
  settings: typeof organizationSettings.$inferSelect,
  input: { documentDate: string; lines: readonly OpeningLine[]; items: readonly OpeningItem[] },
): Promise<{ id: string; number: string; amountPaise: bigint }> {
  const controls = await tx
    .select({ id: accounts.id, systemKey: accounts.systemKey })
    .from(accounts)
    .where(
      and(
        eq(accounts.orgId, scope.orgId),
        inArray(accounts.systemKey, ["receivables", "payables"]),
      ),
    );

  const receivables = controls.find((row) => row.systemKey === "receivables")?.id;
  const payables = controls.find((row) => row.systemKey === "payables")?.id;

  if (!receivables || !payables) throw impossible(`organization ${scope.orgId} lacks a control`);

  if (input.lines.some((line) => line.accountId === receivables || line.accountId === payables))
    throw impossible("an opening line names a control account; its legs are derived");

  const { receivablesPaise, payablesPaise } = controlNets(input.items);
  const legs: OpeningLine[] = [];

  if (receivablesPaise !== 0n)
    legs.push({
      accountId: receivables,
      side: receivablesPaise > 0n ? "debit" : "credit",
      amount: receivablesPaise > 0n ? receivablesPaise : -receivablesPaise,
    });

  if (payablesPaise !== 0n)
    legs.push({
      accountId: payables,
      side: payablesPaise > 0n ? "credit" : "debit",
      amount: payablesPaise > 0n ? payablesPaise : -payablesPaise,
    });

  const posted = await postEntryLines(tx, scope, settings, {
    type: "openingBalance",
    prefix: OPENING_BALANCE_PREFIX,
    documentDate: input.documentDate,
    narration: "Opening balances",
    reference: null,
    controls: ["receivables", "payables"],
    lines: [...input.lines, ...legs],
  });

  // Items number in the cutover's financial year, one series per type; the legacy
  // number is the reference. Each series reserves its numbers in one statement.
  const financialYear = financialYearOf(input.documentDate, settings.financialYearStart);
  const postedAt = new Date();

  for (const type of OPENING_ITEM_TYPES) {
    const items = input.items.filter((item) => item.type === type);

    if (items.length === 0) continue;

    const numbers = await reserveNumbers(
      tx,
      scope.orgId,
      type,
      financialYear,
      OPENING_ITEM_PREFIX[type],
      items.length,
    );

    const rows = items.map((item, index) => ({
      id: Bun.randomUUIDv7(),
      number: numbers[index]!,
      item,
    }));

    for (const chunk of insertChunks(rows)) {
      await tx.insert(documents).values(
        chunk.map(({ id, number, item }) => ({
          id,
          orgId: scope.orgId,
          type: item.type,
          state: "posted" as const,
          number,
          postedAt,
          financialYear,
          documentDate: item.documentDate,
          dueDate: item.dueDate,
          partyId: item.partyId,
          exposureSide: item.side,
          reference: item.reference,
          totalPaise: item.amountPaise,
          roundOffPaise: 0n,
          affectsTax: false,
          createdBy: scope.userId,
        })),
      );

      await tx.insert(partyLedgerLines).values(
        chunk.map(({ id, item }) => ({
          id: Bun.randomUUIDv7(),
          orgId: scope.orgId,
          partyId: item.partyId,
          documentId: id,
          side: item.side,
          kind: "post" as const,
          amountPaise: exposurePaise(item),
          entryDate: input.documentDate,
        })),
      );
    }
  }

  return posted;
}

/**
 * Cancels the Opening Balance with its items, reversing each item's party ledger
 * line on the cutover. Refuses while any item has an active allocation. Only an
 * import posts items, and only while no Opening Balance is posted, so the posted
 * items are this Opening Balance's.
 */
export async function reverseOpening(
  tx: DbTransaction,
  scope: Scope,
  settings: typeof organizationSettings.$inferSelect,
  types: Parameters<typeof reverseDocument>[3],
  openingBalanceId: string,
  reason: string,
): Promise<typeof documents.$inferSelect> {
  const items = await tx
    .select({ id: documents.id, number: documents.number })
    .from(documents)
    .where(
      and(
        eq(documents.orgId, scope.orgId),
        inArray(documents.type, [...OPENING_ITEM_TYPES]),
        eq(documents.state, "posted"),
      ),
    );

  const itemIds = items.map((item) => item.id);

  if (itemIds.length > 0) {
    // Serializes with an apply, which locks the same rows before inserting.
    await lockDocuments(tx, scope.orgId, itemIds);
    const active = await activeAllocationsOf(tx, scope.orgId, itemIds);

    if (active.length > 0) {
      const allocated = new Set(
        active.flatMap((row) => [row.sourceDocumentId, row.targetDocumentId]),
      );

      const numbers = items
        .filter((item) => allocated.has(item.id))
        .map((item) => postedNumber(item.number, item.id));

      const more = numbers.length > 5 ? ` and ${numbers.length - 5} more` : "";

      throw new ORPCError("CONFLICT", {
        message: `Reverse the allocations of ${numbers.slice(0, 5).join(", ")}${more} first.`,
      });
    }
  }

  const cancelled = await reverseDocument(tx, scope, settings, types, openingBalanceId, reason);

  if (itemIds.length > 0) {
    const { cancelledAt } = cancelled;

    if (!cancelledAt) throw impossible(`cancelled opening balance ${cancelled.id} has no instant`);

    await tx
      .update(documents)
      .set({ state: "cancelled", cancelledAt, updatedAt: cancelledAt })
      .where(and(eq(documents.orgId, scope.orgId), inArray(documents.id, itemIds)));

    await reversePartyLedgerLines(tx, scope.orgId, itemIds, cancelled.documentDate);
  }

  return cancelled;
}
