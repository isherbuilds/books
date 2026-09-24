import { db, type DbTransaction } from "@accly/db";
import { allocations } from "@accly/db/schema/allocations";
import { documents } from "@accly/db/schema/documents";
import { journalEntries } from "@accly/db/schema/journal-entries";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, exists, inArray, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { badRequest, impossible } from "../lib/conflict";
import type { Scope } from "../lib/procedures/factory";
import { formatMoney } from "./money";
import { recordEntry } from "./posting";

export type AllocationTarget = { documentId: string; amountPaise: bigint };

const reversal = alias(allocations, "allocation_reversal");

// An apply is active until a reverse row names it. This is the only definition of
// "active"; the subquery correlates with the enclosing query's `allocations` row.
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
 * The document's total less its active allocations, looked up per row of the enclosing
 * query through `allocations (org_id, source/target_document_id)`. A register or picker
 * aggregates only the allocations of the documents it considers, never the
 * Organization's whole allocation history; "active" is still `activeApply`.
 */
export function remainingPaiseOf(orgId: string, side: "source" | "target") {
  const documentId =
    side === "source" ? allocations.sourceDocumentId : allocations.targetDocumentId;

  const allocated = db
    .select({
      allocatedPaise: sql`coalesce(sum(${allocations.amountPaise}), 0)::bigint`,
    })
    .from(allocations)
    .where(and(activeApply(orgId), eq(documentId, documents.id)));

  return sql<bigint>`${documents.totalPaise} - (${allocated})`.mapWith(BigInt);
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

// NO KEY UPDATE, not UPDATE: an allocation insert takes KEY SHARE on both documents it
// names, and an UPDATE lock would make that check wait out of ascending id order.
async function lockDocuments(tx: DbTransaction, orgId: string, documentIds: readonly string[]) {
  return tx
    .select({
      id: documents.id,
      type: documents.type,
      state: documents.state,
      settlementKind: documents.settlementKind,
      partyId: documents.partyId,
      totalPaise: documents.totalPaise,
    })
    .from(documents)
    .where(and(eq(documents.orgId, orgId), inArray(documents.id, [...documentIds])))
    .orderBy(asc(documents.id))
    .for("no key update");
}

/** Locks the source and targets in ascending id order, then rechecks before inserting. */
export async function applyAllocations(
  tx: DbTransaction,
  scope: Scope,
  args: {
    sourceDocumentId: string;
    // A Receipt post allocates from its own draft before numbering it.
    sourceState: "draft" | "posted";
    targets: readonly AllocationTarget[];
    entryDate: string;
  },
): Promise<{ partyId: string; rows: Array<{ id: string; amountPaise: bigint }> }> {
  const targetIds = args.targets.map((target) => target.documentId);

  if (
    targetIds.length === 0 ||
    new Set(targetIds).size !== targetIds.length ||
    args.targets.some((target) => target.amountPaise <= 0n)
  ) {
    throw badRequest(
      "ALLOCATION_TARGET_INVALID",
      "Choose each invoice once with a positive amount.",
    );
  }

  const locked = await lockDocuments(tx, scope.orgId, [args.sourceDocumentId, ...targetIds]);
  const source = locked.find((document) => document.id === args.sourceDocumentId);

  const allocatableReceipt =
    source?.settlementKind === "advance" || source?.settlementKind === "against";

  // A direct Receipt credits income, so it holds no advance to allocate.
  if (
    !source ||
    source.type !== "receipt" ||
    source.state !== args.sourceState ||
    !allocatableReceipt ||
    source.partyId === null
  ) {
    throw badRequest(
      "ALLOCATION_SOURCE_INVALID",
      "Choose an advance or against receipt with a party.",
    );
  }

  const active = await activeAllocationsOf(tx, scope.orgId, [source.id, ...targetIds]);

  // One pass: what each invoice already received, and what this receipt already gave.
  const receivedPaise = new Map<string, bigint>();
  let givenPaise = 0n;

  for (const row of active) {
    if (row.sourceDocumentId === source.id) givenPaise += row.amountPaise;
    receivedPaise.set(
      row.targetDocumentId,
      (receivedPaise.get(row.targetDocumentId) ?? 0n) + row.amountPaise,
    );
  }

  for (const target of args.targets) {
    const invoice = locked.find((document) => document.id === target.documentId);

    if (
      !invoice ||
      invoice.type !== "invoice" ||
      invoice.state !== "posted" ||
      invoice.partyId !== source.partyId
    ) {
      throw badRequest(
        "ALLOCATION_TARGET_INVALID",
        "Choose posted invoices for the same party as the receipt.",
      );
    }

    const outstandingPaise = invoice.totalPaise - (receivedPaise.get(invoice.id) ?? 0n);

    if (target.amountPaise > outstandingPaise) {
      throw badRequest(
        "ALLOCATION_EXCEEDS_OUTSTANDING",
        `Allocation exceeds the invoice outstanding amount of ${formatMoney(outstandingPaise)}.`,
      );
    }
  }

  const allocatedPaise = args.targets.reduce((sum, target) => sum + target.amountPaise, 0n);
  const unappliedPaise = source.totalPaise - givenPaise;

  if (allocatedPaise > unappliedPaise) {
    throw badRequest(
      "ALLOCATION_EXCEEDS_SOURCE",
      `Allocation exceeds the receipt's unapplied amount of ${formatMoney(unappliedPaise)}.`,
    );
  }

  const rows = args.targets.map((target) => ({
    id: Bun.randomUUIDv7(),
    orgId: scope.orgId,
    sourceDocumentId: source.id,
    targetDocumentId: target.documentId,
    amountPaise: target.amountPaise,
    kind: "apply" as const,
    reversesAllocationId: null,
    entryDate: args.entryDate,
    createdBy: scope.userId,
  }));

  await tx.insert(allocations).values(rows);

  return {
    partyId: source.partyId,
    rows: rows.map(({ id, amountPaise }) => ({ id, amountPaise })),
  };
}

/**
 * Appends the reverse row, then reverses the apply's journal entry. An allocation
 * made at Receipt post has no entry of its own, so its reversal posts one.
 */
export async function reverseAllocation(
  tx: DbTransaction,
  scope: Scope,
  allocationId: string,
  entryDate: string,
  narration: string,
): Promise<{ id: string; amountPaise: bigint }> {
  // An apply row and its post entry never change, so they are read before the lock.
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

  if (!apply) {
    throw new ORPCError("CONFLICT", { message: "This allocation is not active." });
  }

  const locked = await lockDocuments(tx, scope.orgId, [
    apply.sourceDocumentId,
    apply.targetDocumentId,
  ]);

  const partyId = locked.find((document) => document.id === apply.sourceDocumentId)?.partyId;

  if (!partyId) throw impossible(`allocation ${allocationId} has a source without a party`);

  // The unique index allows one reverse per apply, so a lost race inserts nothing.
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

  if (!reversed) {
    throw new ORPCError("CONFLICT", { message: "This allocation is not active." });
  }

  await recordEntry(
    tx,
    scope,
    apply.postEntryId
      ? {
          kind: "reverse",
          document: { id: allocationId, type: "allocation" },
          entryDate,
          narration,
        }
      : {
          kind: "post",
          document: {
            id: allocationId,
            posting: {
              type: "allocation",
              direction: "invoiceToAdvance",
              partyId,
              amountPaise: apply.amountPaise,
            },
          },
          entryDate,
          narration,
        },
  );

  return { id: reversed.id, amountPaise: apply.amountPaise };
}

/** An Invoice's settlement state; `today` is the Organization's business date. */
export function invoiceSettlement(
  invoice: {
    state: (typeof documents.$inferSelect)["state"];
    totalPaise: bigint;
    outstandingPaise: bigint;
    dueDate: string | null;
  },
  today: string,
): { settlementStatus: "paid" | "partPaid" | "unpaid"; overdue: boolean } {
  const settlementStatus =
    invoice.outstandingPaise === 0n
      ? "paid"
      : invoice.outstandingPaise < invoice.totalPaise
        ? "partPaid"
        : "unpaid";

  return {
    settlementStatus,
    overdue:
      invoice.state === "posted" &&
      settlementStatus !== "paid" &&
      invoice.dueDate !== null &&
      invoice.dueDate < today,
  };
}
