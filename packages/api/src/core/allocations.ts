import { db, type DbTransaction } from "@accly/db";
import { allocations } from "@accly/db/schema/allocations";
import { documents } from "@accly/db/schema/documents";
import { journalEntries } from "@accly/db/schema/journal-entries";
import type { organizationSettings } from "@accly/db/schema/organization-settings";
import { partyLedgerLines } from "@accly/db/schema/party-ledger-lines";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, exists, inArray, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { badRequest, impossible } from "../lib/conflict";
import { paiseSum } from "../lib/sql";
import { requirePermission, type Scope } from "../lib/procedures/factory";
import { documentRole, type Side } from "./document-roles";
import { assertPeriodOpen } from "./locks";
import { formatMoney } from "./money";
import { recordEntry, reverseEntries } from "./posting";

export type AllocationTarget = { documentId: string; amountPaise: bigint };

export type AllocationPair = {
  sourceDocumentId: string;
  targetDocumentId: string;
  amountPaise: bigint;
};

type LockedDocument = Pick<
  typeof documents.$inferSelect,
  | "id"
  | "number"
  | "type"
  | "state"
  | "settlementKind"
  | "exposureSide"
  | "partyId"
  | "documentDate"
>;

const reversal = alias(allocations, "allocation_reversal");

// `allocations_kind_check` makes a non-null `reverses_allocation_id` mean a reversal,
// so the probe reads only `allocations_org_reverses_idx` and never the heap.
function reversalOf(orgId: string) {
  return db
    .select({ id: reversal.id })
    .from(reversal)
    .where(and(eq(reversal.orgId, orgId), eq(reversal.reversesAllocationId, allocations.id)));
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
 * Correlated, index-backed settlement capacity. A Journal is a source for a party
 * it credits and a target for one it debits, and counts only that party's
 * allocations; other documents use their header party. Pass null only when the
 * enclosing query excludes Journals.
 */
export function settlementPaise(orgId: string, role: "source" | "target", partyId: string | null) {
  const [own, other] =
    role === "source"
      ? [allocations.sourceDocumentId, allocations.targetDocumentId]
      : [allocations.targetDocumentId, allocations.sourceDocumentId];

  const journalAmount =
    role === "source"
      ? sql`-${partyLedgerLines.amountPaise}`
      : sql`${partyLedgerLines.amountPaise}`;

  const capacity = sql`coalesce((${db
    .select({
      amount: sql`case when "documents"."type" = 'journal'
        then greatest(${journalAmount}, 0)
        else abs(${partyLedgerLines.amountPaise}) end`,
    })
    .from(partyLedgerLines)
    .where(
      and(
        eq(partyLedgerLines.orgId, orgId),
        eq(partyLedgerLines.documentId, documents.id),
        eq(partyLedgerLines.partyId, partyId ?? documents.partyId),
        eq(partyLedgerLines.kind, "post"),
      ),
    )}), 0)`;

  const counterpart = alias(documents, "allocation_counterpart");

  // A reversal copies its apply's source, target and amount, and an apply has at most
  // one (`allocations_org_reverses_idx` is unique), so applies minus reversals is the
  // active total. One scan of the document's allocations; no reversal anti-join per row.
  const applied = db
    .select({
      amount: paiseSum(
        sql`case when ${allocations.kind} = 'apply' then ${allocations.amountPaise} else -${allocations.amountPaise} end`,
      ),
    })
    .from(allocations)
    .where(
      and(
        eq(allocations.orgId, orgId),
        eq(own, documents.id),
        partyId
          ? or(
              sql`${documents.type} <> 'journal'`,
              exists(
                db
                  .select({ id: counterpart.id })
                  .from(counterpart)
                  .where(
                    and(
                      eq(counterpart.orgId, orgId),
                      eq(counterpart.id, other),
                      eq(counterpart.partyId, partyId),
                    ),
                  ),
              ),
            )
          : undefined,
      ),
    );

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
      entryDate: allocations.entryDate,
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
export async function lockDocuments(
  tx: DbTransaction,
  orgId: string,
  documentIds: readonly string[],
) {
  return tx
    .select({
      id: documents.id,
      number: documents.number,
      type: documents.type,
      state: documents.state,
      settlementKind: documents.settlementKind,
      exposureSide: documents.exposureSide,
      partyId: documents.partyId,
      documentDate: documents.documentDate,
    })
    .from(documents)
    .where(and(eq(documents.orgId, orgId), inArray(documents.id, [...documentIds])))
    .orderBy(asc(documents.id))
    .for("no key update");
}

/** Only money held in an advance account needs a journal entry when allocated after post. */
function advanceSide(document: LockedDocument): Side | null {
  const role = documentRole(document);

  return role.advance ? (role.source ?? null) : null;
}

/** Lock all named documents in ascending id order, consume their balances, and move applied advances. */
export async function applyAllocations(
  tx: DbTransaction,
  scope: Scope,
  settings: typeof organizationSettings.$inferSelect,
  args: {
    pairs: readonly AllocationPair[];
    draftDocumentId: string | null;
    allowedSourceTypes?: readonly ("creditNote" | "debitNote" | "payment")[];
    partyId?: string;
  },
): Promise<
  { id: string; amountPaise: bigint; sourceNumber: string | null; targetNumber: string | null }[]
> {
  const keys = args.pairs.map((pair) => `${pair.sourceDocumentId}:${pair.targetDocumentId}`);

  if (new Set(keys).size !== keys.length || args.pairs.some((pair) => pair.amountPaise <= 0n)) {
    throw badRequest("ALLOCATION_TARGET_INVALID", "Choose each pair once with a positive amount.");
  }

  const ids = [
    ...new Set(args.pairs.flatMap((pair) => [pair.sourceDocumentId, pair.targetDocumentId])),
  ];

  const locked = await lockDocuments(tx, scope.orgId, ids);
  const byId = new Map(locked.map((document) => [document.id, document]));

  // A Journal is settled only by someone who may read it, whichever path names it.
  if (locked.some((document) => document.type === "journal"))
    // oxlint-disable-next-line accly/no-permission-in-handler -- the permission depends on the stored documents, read inside the transaction
    requirePermission(scope, { journal: ["read"] });

  const [first] = args.pairs;
  const firstSource = first && byId.get(first.sourceDocumentId);
  const firstTarget = first && byId.get(first.targetDocumentId);

  if (!firstTarget)
    throw badRequest(
      "ALLOCATION_TARGET_INVALID",
      "Choose a posted target for the same party and side.",
    );
  const side = firstSource && documentRole(firstSource).source;

  const partyId =
    firstSource?.type === "journal" ? (args.partyId ?? firstTarget.partyId) : firstSource?.partyId;

  if (!side || !partyId) {
    throw badRequest(
      "ALLOCATION_SOURCE_INVALID",
      "Choose a posted settlement source with a party.",
    );
  }

  const applies = args.pairs.map((pair) => {
    const source = byId.get(pair.sourceDocumentId);
    const target = byId.get(pair.targetDocumentId);

    if (
      !source ||
      documentRole(source).source !== side ||
      (source.type !== "journal" && source.partyId !== partyId) ||
      (source.state !== "posted" &&
        !(source.state === "draft" && source.id === args.draftDocumentId)) ||
      (args.allowedSourceTypes && !args.allowedSourceTypes.some((type) => type === source.type))
    ) {
      throw badRequest(
        "ALLOCATION_SOURCE_INVALID",
        "Choose a posted source for the same party and side.",
      );
    }

    if (
      !target ||
      (source.type === "journal" && target.type !== "invoice") ||
      documentRole(target).target !== side ||
      (target.type !== "journal" && target.partyId !== partyId) ||
      (target.state !== "posted" &&
        !(target.state === "draft" && target.id === args.draftDocumentId))
    ) {
      throw badRequest(
        "ALLOCATION_TARGET_INVALID",
        "Choose a posted target for the same party and side.",
      );
    }

    const row = {
      id: Bun.randomUUIDv7(),
      orgId: scope.orgId,
      ...pair,
      kind: "apply" as const,
      reversesAllocationId: null,
      entryDate:
        source.documentDate > target.documentDate ? source.documentDate : target.documentDate,
      createdBy: scope.userId,
    };

    return { row, source, target };
  });

  const rows = applies.map(({ row }) => row);

  for (const row of rows)
    await assertPeriodOpen(tx, scope, settings, { entryDate: row.entryDate, affectsTax: false });

  const sourceIds = new Set(args.pairs.map((pair) => pair.sourceDocumentId));
  const targetIds = new Set(args.pairs.map((pair) => pair.targetDocumentId));
  const sourceSettlement = settlementPaise(scope.orgId, "source", partyId);
  const targetSettlement = settlementPaise(scope.orgId, "target", partyId);

  // Read after the locks, so no concurrent apply changes a balance before the insert.
  const balances = await tx
    .select({
      id: documents.id,
      source: sourceSettlement.balancePaise,
      sourceCapacity: sourceSettlement.capacityPaise,
      target: targetSettlement.balancePaise,
      targetCapacity: targetSettlement.capacityPaise,
    })
    .from(documents)
    .where(and(eq(documents.orgId, scope.orgId), inArray(documents.id, ids)));

  const left = new Map<string, bigint>();

  for (const row of balances) {
    const isJournal = byId.get(row.id)?.type === "journal";

    // A Journal is a source only for a party it credits.
    if (sourceIds.has(row.id) && isJournal && row.sourceCapacity <= 0n)
      throw badRequest(
        "ALLOCATION_SOURCE_INVALID",
        "Choose a posted source for the same party and side.",
      );

    // A Journal is a target only for a party it debits.
    if (targetIds.has(row.id) && isJournal && row.targetCapacity <= 0n)
      throw badRequest(
        "ALLOCATION_TARGET_INVALID",
        "Choose a posted target for the same party and side.",
      );

    left.set(row.id, sourceIds.has(row.id) ? row.source : row.target);
  }

  const remaining = (id: string) => {
    const balance = left.get(id);

    if (balance === undefined) throw impossible(`locked document ${id} has no balance`);

    return balance;
  };

  for (const pair of args.pairs) {
    left.set(pair.sourceDocumentId, remaining(pair.sourceDocumentId) - pair.amountPaise);
    left.set(pair.targetDocumentId, remaining(pair.targetDocumentId) - pair.amountPaise);
  }

  for (const targetId of targetIds) {
    const outstanding = remaining(targetId);

    if (outstanding < 0n)
      throw badRequest(
        "ALLOCATION_EXCEEDS_OUTSTANDING",
        `Allocation exceeds outstanding by ${formatMoney(-outstanding)}.`,
      );
  }

  for (const sourceId of sourceIds) {
    const unapplied = remaining(sourceId);

    if (unapplied < 0n)
      throw badRequest(
        "ALLOCATION_EXCEEDS_SOURCE",
        `Allocation exceeds unapplied amount by ${formatMoney(-unapplied)}.`,
      );
  }

  await tx.insert(allocations).values(rows);

  // Money a posted advance holds moves from the advance account to the control account.
  // A source posting now credits the control account itself, and a note holds no advance.
  for (const { row, source } of applies) {
    const entrySide = source.id === args.draftDocumentId ? null : advanceSide(source);

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
        entryDate: row.entryDate,
        narration: "Apply advance to claim",
      });
  }

  return applies.map(({ row, source, target }) => ({
    id: row.id,
    amountPaise: row.amountPaise,
    sourceNumber: source.number,
    targetNumber: target.number,
  }));
}

type ApplyRow = {
  sourceDocumentId: string;
  targetDocumentId: string;
  amountPaise: bigint;
  entryDate: string;
  postEntryId: string | null;
};

async function activeApplyRow(
  tx: DbTransaction,
  scope: Scope,
  allocationId: string,
): Promise<ApplyRow> {
  const [apply] = await tx
    .select({
      sourceDocumentId: allocations.sourceDocumentId,
      targetDocumentId: allocations.targetDocumentId,
      amountPaise: allocations.amountPaise,
      entryDate: allocations.entryDate,
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

  return apply;
}

/** Append a reverse, then reverse its entry or release a source allocated at post. */
async function reverseApply(
  tx: DbTransaction,
  scope: Scope,
  allocationId: string,
  apply: ApplyRow,
  source: LockedDocument,
  narration: string,
): Promise<string> {
  const entryDate = apply.entryDate;

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
    const side = advanceSide(source);

    if (side) {
      if (!source.partyId)
        throw impossible(`allocation ${allocationId} has a source without a party`);

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
  }

  return reversed.id;
}

/** Lock source and target in id order, then reverse the apply. */
export async function reverseAllocation(
  tx: DbTransaction,
  scope: Scope,
  settings: typeof organizationSettings.$inferSelect,
  allocationId: string,
  narration: string,
): Promise<{
  id: string;
  amountPaise: bigint;
  sourceNumber: string | null;
  targetNumber: string | null;
}> {
  const apply = await activeApplyRow(tx, scope, allocationId);

  const locked = await lockDocuments(tx, scope.orgId, [
    apply.sourceDocumentId,
    apply.targetDocumentId,
  ]);

  const source = locked.find((document) => document.id === apply.sourceDocumentId);
  const target = locked.find((document) => document.id === apply.targetDocumentId);

  if (!source || !target) throw impossible(`allocation ${allocationId} lost a document`);

  await assertPeriodOpen(tx, scope, settings, { entryDate: apply.entryDate, affectsTax: false });

  const id = await reverseApply(tx, scope, allocationId, apply, source, narration);

  return {
    id,
    amountPaise: apply.amountPaise,
    sourceNumber: source.number,
    targetNumber: target.number,
  };
}

/**
 * Reverse an apply targeting a document being cancelled. The cancel already holds
 * the target's row lock; the source is read unlocked (its posting fields are
 * immutable after post) so cancellation takes no other document's lock out of order.
 */
export async function reverseAllocationToCancelled(
  tx: DbTransaction,
  scope: Scope,
  settings: typeof organizationSettings.$inferSelect,
  allocationId: string,
  narration: string,
): Promise<void> {
  const apply = await activeApplyRow(tx, scope, allocationId);

  const [source] = await tx
    .select({
      id: documents.id,
      number: documents.number,
      type: documents.type,
      state: documents.state,
      settlementKind: documents.settlementKind,
      exposureSide: documents.exposureSide,
      partyId: documents.partyId,
      documentDate: documents.documentDate,
    })
    .from(documents)
    .where(and(eq(documents.orgId, scope.orgId), eq(documents.id, apply.sourceDocumentId)))
    .limit(1);

  if (!source) throw impossible(`allocation ${allocationId} lost a document`);

  await assertPeriodOpen(tx, scope, settings, { entryDate: apply.entryDate, affectsTax: false });

  await reverseApply(tx, scope, allocationId, apply, source, narration);
}
