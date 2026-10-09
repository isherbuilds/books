import { db, type DbTransaction } from "@accly/db";
import { documentLines } from "@accly/db/schema/document-lines";
import { documents } from "@accly/db/schema/documents";
import { tdsDeductions } from "@accly/db/schema/tds-deductions";
import { taxRates } from "@accly/db/schema/tax-rates";
import { and, eq, inArray } from "drizzle-orm";

import { badRequest, impossible } from "../lib/conflict";
import { paiseSum } from "../lib/sql";
import { sumPaise } from "./money";

type Executor = typeof db | DbTransaction;

const NOTE_OF = { invoice: "creditNote", bill: "debitNote" } as const;

/**
 * What posted notes against a claim already returned: each line's earlier notes and
 * what remains of it, the notes' taxable value and total, and the TDS they reversed.
 * Cancelled notes release theirs. A reader who may not read notes sees none.
 */
export async function priorNotes<Line extends { id: string; amountPaise: bigint }>(
  executor: Executor,
  orgId: string,
  source: { id: string; type: keyof typeof NOTE_OF },
  lines: readonly Line[],
  readable = true,
) {
  const posted = and(
    eq(documents.orgId, orgId),
    eq(documents.type, NOTE_OF[source.type]),
    eq(documents.state, "posted"),
    eq(documents.againstDocumentId, source.id),
  );

  // One connection inside a transaction, so the two reads run in turn.
  const prior =
    readable && lines.length > 0
      ? await executor
          .select({
            sourceLineId: documentLines.sourceLineId,
            amountPaise: paiseSum(documentLines.amountPaise),
            cgstPaise: paiseSum(documentLines.cgstPaise),
            sgstPaise: paiseSum(documentLines.sgstPaise),
            igstPaise: paiseSum(documentLines.igstPaise),
          })
          .from(documentLines)
          .innerJoin(documents, and(posted, eq(documents.id, documentLines.documentId)))
          .where(
            and(
              eq(documentLines.orgId, orgId),
              inArray(
                documentLines.sourceLineId,
                lines.map((line) => line.id),
              ),
            ),
          )
          .groupBy(documentLines.sourceLineId)
      : [];

  const [totals] = readable
    ? await executor
        .select({
          totalPaise: paiseSum(documents.totalPaise),
          reversedTdsPaise: paiseSum(tdsDeductions.amountPaise),
        })
        .from(documents)
        .leftJoin(
          tdsDeductions,
          and(eq(tdsDeductions.orgId, orgId), eq(tdsDeductions.documentId, documents.id)),
        )
        .where(posted)
    : [{ totalPaise: 0n, reversedTdsPaise: 0n }];

  if (!totals) throw impossible("note aggregate returned no row");

  const used = new Map(prior.map((line) => [line.sourceLineId, line]));

  return {
    lines: lines.map((line) => {
      const priorNote = used.get(line.id) ?? null;

      return {
        ...line,
        priorNote,
        remainingPaise: line.amountPaise - (priorNote?.amountPaise ?? 0n),
      };
    }),
    taxablePaise: sumPaise(prior.map((line) => line.amountPaise)),
    ...totals,
  };
}

/**
 * A posted claim a note is raised against, its lines with what earlier notes returned,
 * and a bill's TDS. Inside a transaction the claim is locked until the note posts.
 */
export async function noteSource(
  executor: Executor,
  orgId: string,
  sourceDocumentId: string,
  type: "creditNote" | "debitNote",
) {
  const expected = type === "creditNote" ? "invoice" : "bill";

  const query = executor
    .select({
      id: documents.id,
      partyId: documents.partyId,
      documentDate: documents.documentDate,
      placeOfSupplyStateCode: documents.placeOfSupplyStateCode,
      intraState: documents.intraState,
      totalPaise: documents.totalPaise,
      affectsTax: documents.affectsTax,
    })
    .from(documents)
    .where(
      and(
        eq(documents.orgId, orgId),
        eq(documents.id, sourceDocumentId),
        eq(documents.type, expected),
        eq(documents.state, "posted"),
      ),
    );

  const [source] = await (executor === db ? query : query.for("no key update"));

  if (!source || !source.partyId || source.intraState === null)
    throw badRequest("NOTE_SOURCE_INVALID", "Choose a posted source document.");

  const [tds] =
    type === "debitNote"
      ? await executor
          .select({
            tdsSectionId: tdsDeductions.tdsSectionId,
            basePaise: tdsDeductions.basePaise,
            amountPaise: tdsDeductions.amountPaise,
          })
          .from(tdsDeductions)
          .where(
            and(eq(tdsDeductions.orgId, orgId), eq(tdsDeductions.documentId, sourceDocumentId)),
          )
          .limit(1)
      : [];

  const lines = await executor
    .select({
      id: documentLines.id,
      accountId: documentLines.accountId,
      description: documentLines.description,
      hsnSac: documentLines.hsnSac,
      taxRateId: documentLines.taxRateId,
      rateBasisPoints: taxRates.rateBasisPoints,
      itcEligible: documentLines.itcEligible,
      amountPaise: documentLines.amountPaise,
      cgstPaise: documentLines.cgstPaise,
      sgstPaise: documentLines.sgstPaise,
      igstPaise: documentLines.igstPaise,
    })
    .from(documentLines)
    .leftJoin(taxRates, and(eq(taxRates.orgId, orgId), eq(taxRates.id, documentLines.taxRateId)))
    .where(and(eq(documentLines.orgId, orgId), eq(documentLines.documentId, sourceDocumentId)));

  return {
    ...source,
    partyId: source.partyId,
    intraState: source.intraState,
    prior: await priorNotes(executor, orgId, { id: source.id, type: expected }, lines),
    tds: tds ?? null,
  };
}
