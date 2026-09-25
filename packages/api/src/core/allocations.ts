import { db, type DbTransaction } from "@accly/db";
import { allocations } from "@accly/db/schema/allocations";
import { documents } from "@accly/db/schema/documents";
import { journalEntries } from "@accly/db/schema/journal-entries";
import { partyLedgerLines } from "@accly/db/schema/party-ledger-lines";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, exists, inArray, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { badRequest, impossible } from "../lib/conflict";
import type { Scope } from "../lib/procedures/factory";
import { formatMoney } from "./money";
import { recordEntry, reverseEntries } from "./posting";

export type AllocationTarget = { documentId: string; amountPaise: bigint };

export type AllocationPair = {
  sourceDocumentId: string;
  targetDocumentId: string;
  amountPaise: bigint;
};

type Side = "receivable" | "payable";

type LockedDocument = Pick<
  typeof documents.$inferSelect,
  "id" | "type" | "state" | "settlementKind" | "exposureSide" | "partyId"
>;

const reversal = alias(allocations, "allocation_reversal");

function reversalOf(orgId: string) {
  return db
    .select({ id: reversal.id })
    .from(reversal)
    .where(
      and(
        eq(reversal.orgId, orgId),
        eq(reversal.kind, "reverse"),
        eq(reversal.reversesAllocationId, allocations.id),
      ),
    );
}

function activeApply(orgId: string) {
  return and(
    eq(allocations.orgId, orgId),
    eq(allocations.kind, "apply"),
    notExists(reversalOf(orgId)),
  );
}

/** Whether the enclosing query's apply row has been reversed. */
export function allocationReversed(orgId: string) {
  return sql<boolean>`${exists(reversalOf(orgId))}`;
}

/**
 * A document's settlement capacity and what is left of it, as correlated scalars on the
 * enclosing `documents` row. Every settling document names one Party and posts one
 * party-ledger line for it (a unique index), so capacity is that line's absolute
 * amount, read by index; the balance subtracts active applies through the allocation
 * index for `role`. Grouped joins would aggregate the whole organization before a party
 * filter or a page limit applies. A document with lines for two parties (a slice 9a
 * Journal) makes the scalar fail loudly until this read takes the party.
 */
export function settlementPaise(orgId: string, role: "source" | "target") {
  const documentId =
    role === "source" ? allocations.sourceDocumentId : allocations.targetDocumentId;

  const capacity = sql`coalesce((${db
    .select({ amount: sql`abs(${partyLedgerLines.amountPaise})` })
    .from(partyLedgerLines)
    .where(
      and(
        eq(partyLedgerLines.orgId, orgId),
        eq(partyLedgerLines.documentId, documents.id),
        eq(partyLedgerLines.kind, "post"),
      ),
    )}), 0)`;

  const applied = db
    .select({ amount: sql`coalesce(sum(${allocations.amountPaise}), 0)` })
    .from(allocations)
    .where(and(activeApply(orgId), eq(documentId, documents.id)));

  return {
    capacityPaise: sql<bigint>`${capacity}::bigint`.mapWith(BigInt),
    balancePaise: sql<bigint>`(${capacity} - (${applied}))::bigint`.mapWith(BigInt),
  };
}

/** Active applies from or to any of the documents. */
export async function activeAllocationsOf(
  tx: DbTransaction,
  orgId: string,
  documentIds: readonly string[],
) {
  return tx
    .select({
      id: allocations.id,
      sourceDocumentId: allocations.sourceDocumentId,
      targetDocumentId: allocations.targetDocumentId,
      amountPaise: allocations.amountPaise,
    })
    .from(allocations)
    .where(
      and(
        activeApply(orgId),
        or(
          inArray(allocations.sourceDocumentId, [...documentIds]),
          inArray(allocations.targetDocumentId, [...documentIds]),
        ),
      ),
    );
}

// NO KEY UPDATE: inserts take KEY SHARE on both named documents.
async function lockDocuments(tx: DbTransaction, orgId: string, documentIds: readonly string[]) {
  return tx
    .select({
      id: documents.id,
      type: documents.type,
      state: documents.state,
      settlementKind: documents.settlementKind,
      exposureSide: documents.exposureSide,
      partyId: documents.partyId,
    })
    .from(documents)
    .where(and(eq(documents.orgId, orgId), inArray(documents.id, [...documentIds])))
    .orderBy(asc(documents.id))
    .for("no key update");
}

function roleOf(document: LockedDocument): { side: Side; role: "source" | "target" } | null {
  switch (document.type) {
    case "invoice":
      return { side: "receivable", role: "target" };
    case "bill":
      return { side: "payable", role: "target" };
    case "creditNote":
      return { side: "receivable", role: "source" };
    case "debitNote":
      return { side: "payable", role: "source" };
    case "receipt":
      return document.exposureSide === "receivable" && document.settlementKind !== "direct"
        ? { side: "receivable", role: "source" }
        : null;
    case "payment":
      return document.settlementKind !== "direct" && document.exposureSide
        ? {
            side: document.exposureSide,
            role: document.exposureSide === "payable" ? "source" : "target",
          }
        : null;
    default:
      return null;
  }
}

/** Only money held in an advance account needs a journal entry when allocated after post. */
function allocationEntrySide(
  source: Pick<LockedDocument, "type" | "settlementKind" | "exposureSide">,
): Side | null {
  if (source.settlementKind === "direct") return null;

  if (source.type === "receipt" && source.exposureSide === "receivable") return "receivable";

  if (source.type === "payment" && source.exposureSide === "payable") return "payable";

  return null;
}

/** Lock all named documents in ascending id order, consume their balances, and move applied advances. */
export async function applyAllocations(
  tx: DbTransaction,
  scope: Scope,
  args: {
    pairs: readonly AllocationPair[];
    draftDocumentId: string | null;
    entryDate: string;
    requiredSourceType?: "creditNote";
  },
): Promise<{ id: string; amountPaise: bigint }[]> {
  if (args.pairs.length === 0)
    throw badRequest("ALLOCATION_TARGET_INVALID", "Choose an allocation.");
  const keys = args.pairs.map((pair) => `${pair.sourceDocumentId}:${pair.targetDocumentId}`);

  if (new Set(keys).size !== keys.length || args.pairs.some((pair) => pair.amountPaise <= 0n)) {
    throw badRequest("ALLOCATION_TARGET_INVALID", "Choose each pair once with a positive amount.");
  }

  const ids = [
    ...new Set(args.pairs.flatMap((pair) => [pair.sourceDocumentId, pair.targetDocumentId])),
  ];

  const locked = await lockDocuments(tx, scope.orgId, ids);
  const byId = new Map(locked.map((document) => [document.id, document]));
  const firstSource = byId.get(args.pairs[0]!.sourceDocumentId);
  const firstRole = firstSource && roleOf(firstSource);
  const partyId = firstSource?.partyId;

  if (!firstRole || firstRole.role !== "source" || !partyId) {
    throw badRequest(
      "ALLOCATION_SOURCE_INVALID",
      "Choose a posted settlement source with a party.",
    );
  }

  const side = firstRole.side;

  for (const pair of args.pairs) {
    const source = byId.get(pair.sourceDocumentId);
    const target = byId.get(pair.targetDocumentId);

    if (
      !source ||
      roleOf(source)?.role !== "source" ||
      roleOf(source)?.side !== side ||
      source.partyId !== partyId ||
      (source.state !== "posted" &&
        !(source.state === "draft" && source.id === args.draftDocumentId)) ||
      (args.requiredSourceType && source.type !== args.requiredSourceType)
    ) {
      throw badRequest(
        "ALLOCATION_SOURCE_INVALID",
        "Choose a posted source for the same party and side.",
      );
    }

    if (
      !target ||
      roleOf(target)?.role !== "target" ||
      roleOf(target)?.side !== side ||
      target.partyId !== partyId ||
      (target.state !== "posted" &&
        !(target.state === "draft" && target.id === args.draftDocumentId))
    ) {
      throw badRequest(
        "ALLOCATION_TARGET_INVALID",
        "Choose a posted target for the same party and side.",
      );
    }
  }

  const sourceIds = new Set(args.pairs.map((pair) => pair.sourceDocumentId));
  const targetIds = new Set(args.pairs.map((pair) => pair.targetDocumentId));

  // Read after the locks, so no concurrent apply changes a balance before the insert.
  const balances = await tx
    .select({
      id: documents.id,
      source: settlementPaise(scope.orgId, "source").balancePaise,
      target: settlementPaise(scope.orgId, "target").balancePaise,
    })
    .from(documents)
    .where(and(eq(documents.orgId, scope.orgId), inArray(documents.id, ids)));

  const left = new Map(
    balances.map((row) => [row.id, sourceIds.has(row.id) ? row.source : row.target]),
  );

  for (const pair of args.pairs) {
    left.set(pair.sourceDocumentId, left.get(pair.sourceDocumentId)! - pair.amountPaise);
    left.set(pair.targetDocumentId, left.get(pair.targetDocumentId)! - pair.amountPaise);
  }

  for (const targetId of targetIds) {
    const outstanding = left.get(targetId)!;

    if (outstanding < 0n)
      throw badRequest(
        "ALLOCATION_EXCEEDS_OUTSTANDING",
        `Allocation exceeds outstanding by ${formatMoney(-outstanding)}.`,
      );
  }

  for (const sourceId of sourceIds) {
    const unapplied = left.get(sourceId)!;

    if (unapplied < 0n)
      throw badRequest(
        "ALLOCATION_EXCEEDS_SOURCE",
        `Allocation exceeds unapplied amount by ${formatMoney(-unapplied)}.`,
      );
  }

  const rows = args.pairs.map((pair) => ({
    id: Bun.randomUUIDv7(),
    orgId: scope.orgId,
    ...pair,
    kind: "apply" as const,
    reversesAllocationId: null,
    entryDate: args.entryDate,
    createdBy: scope.userId,
  }));

  await tx.insert(allocations).values(rows);

  // Money a posted advance holds moves from the advance account to the control account.
  // A source posting now credits the control account itself, and a note holds no advance.
  for (const row of rows) {
    const source = byId.get(row.sourceDocumentId)!;
    const entrySide = source.id === args.draftDocumentId ? null : allocationEntrySide(source);

    if (entrySide)
      await recordEntry(tx, scope, {
        document: {
          id: row.id,
          posting: {
            type: "allocation",
            side: entrySide,
            direction: "apply",
            partyId,
            amountPaise: row.amountPaise,
          },
        },
        entryDate: args.entryDate,
        narration: "Apply advance to claim",
      });
  }

  return rows.map(({ id, amountPaise }) => ({ id, amountPaise }));
}

/** Append a reverse, then reverse its entry or release a source allocated at post. */
export async function reverseAllocation(
  tx: DbTransaction,
  scope: Scope,
  allocationId: string,
  entryDate: string,
  narration: string,
): Promise<{ id: string; amountPaise: bigint }> {
  const [apply] = await tx
    .select({
      sourceDocumentId: allocations.sourceDocumentId,
      targetDocumentId: allocations.targetDocumentId,
      amountPaise: allocations.amountPaise,
      postEntryId: journalEntries.id,
    })
    .from(allocations)
    .leftJoin(
      journalEntries,
      and(
        eq(journalEntries.orgId, scope.orgId),
        eq(journalEntries.documentType, "allocation"),
        eq(journalEntries.documentId, allocations.id),
        eq(journalEntries.kind, "post"),
      ),
    )
    .where(
      and(
        eq(allocations.orgId, scope.orgId),
        eq(allocations.id, allocationId),
        eq(allocations.kind, "apply"),
      ),
    )
    .limit(1);

  if (!apply) throw new ORPCError("CONFLICT", { message: "This allocation is not active." });

  const locked = await lockDocuments(tx, scope.orgId, [
    apply.sourceDocumentId,
    apply.targetDocumentId,
  ]);

  const source = locked.find((document) => document.id === apply.sourceDocumentId);

  if (!source?.partyId) throw impossible(`allocation ${allocationId} has a source without a party`);

  const [reversed] = await tx
    .insert(allocations)
    .values({
      id: Bun.randomUUIDv7(),
      orgId: scope.orgId,
      sourceDocumentId: apply.sourceDocumentId,
      targetDocumentId: apply.targetDocumentId,
      amountPaise: apply.amountPaise,
      kind: "reverse",
      reversesAllocationId: allocationId,
      entryDate,
      createdBy: scope.userId,
    })
    .onConflictDoNothing({
      target: [allocations.orgId, allocations.reversesAllocationId],
      where: sql`${allocations.reversesAllocationId} is not null`,
    })
    .returning({ id: allocations.id });

  if (!reversed) throw new ORPCError("CONFLICT", { message: "This allocation is not active." });

  if (apply.postEntryId) {
    await reverseEntries(tx, scope, [apply.postEntryId], { entryDate, narration });
  } else {
    const side = allocationEntrySide(source);

    if (side)
      await recordEntry(tx, scope, {
        document: {
          id: allocationId,
          posting: {
            type: "allocation",
            side,
            direction: "release",
            partyId: source.partyId,
            amountPaise: apply.amountPaise,
          },
        },
        entryDate,
        narration,
      });
  }

  return { id: reversed.id, amountPaise: apply.amountPaise };
}
