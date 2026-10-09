import { db, type DbTransaction } from "@accly/db";
import { documentLines } from "@accly/db/schema/document-lines";
import { documents } from "@accly/db/schema/documents";
import { parties } from "@accly/db/schema/parties";
import { tdsDeductions } from "@accly/db/schema/tds-deductions";
import { taxRates } from "@accly/db/schema/tax-rates";
import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { audit } from "@accly/db/audit";
import { settlementPaise } from "../core/allocations";
import {
  accountLine,
  organizationSnapshot,
  partySnapshot,
  postDocument,
  purchaseLegs,
  type PostDocumentLine,
} from "../core/documents";
import { computeNoteLines, noteTdsReversal } from "../core/note-lines";
import { noteSource } from "../core/note-source";
import { documentTotals, taxTotals, withLineTax } from "../core/tax";
import type { CreditNotePosting, DebitNotePosting } from "../core/posting";
import { businessDate } from "../lib/business-date";
import { badRequest, impossible, nth } from "../lib/conflict";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { dateOnly, documentListFields, orderedPeriod, positiveMoney, reason } from "../lib/schemas";
import { allocationsOf, cancelDocument, registerPage, printedPartyName } from "../lib/settlements";
import { orgSettings } from "../lib/org-settings";

const NOTE_TYPES = ["creditNote", "debitNote"] as const;

const noteType = z.enum(NOTE_TYPES);

// Both reads filter to notes, so the column narrows to the two note types.
const noteTypeColumn = sql<(typeof NOTE_TYPES)[number]>`${documents.type}`;

const noteLines = z
  .array(z.object({ sourceLineId: z.uuid(), amount: positiveMoney }))
  .min(1)
  .max(100)
  .superRefine((lines, context) => {
    const seen = new Set<string>();
    lines.forEach((line, index) => {
      if (seen.has(line.sourceLineId))
        context.addIssue({
          code: "custom",
          path: [index, "sourceLineId"],
          message: "Choose each source line once.",
        });
      seen.add(line.sourceLineId);
    });
  });

const quoteInput = orgInput
  .extend({ type: noteType, againstDocumentId: z.uuid(), lines: noteLines })
  .strict();

const postInput = quoteInput
  .extend({
    documentDate: dateOnly.optional(),
    reference: z.string().trim().max(40).optional(),
    narration: reason,
  })
  .strict();

const against = alias(documents, "note_against");

/** The note's lines, totals and TDS reversal, worked out the same way for a quote and a post. */
async function resolveNote(
  executor: typeof db | DbTransaction,
  orgId: string,
  input: z.output<typeof quoteInput>,
) {
  const source = await noteSource(executor, orgId, input.againstDocumentId, input.type);
  const byId = new Map(source.prior.lines.map((line) => [line.id, line]));

  const selected = input.lines.map((line) => {
    const original = byId.get(line.sourceLineId);

    if (!original)
      throw badRequest(
        "NOTE_SOURCE_INVALID",
        `Line ${line.sourceLineId} does not belong to the source document.`,
      );

    return { original, amountPaise: line.amount };
  });

  const calculated = computeNoteLines({
    intraState: source.intraState,
    lines: selected.map(({ original, amountPaise }) => ({
      source: {
        taxablePaise: original.amountPaise,
        cgstPaise: original.cgstPaise,
        sgstPaise: original.sgstPaise,
        igstPaise: original.igstPaise,
        rateBasisPoints: original.rateBasisPoints,
      },
      prior: {
        taxablePaise: original.priorNote?.amountPaise ?? 0n,
        cgstPaise: original.priorNote?.cgstPaise ?? 0n,
        sgstPaise: original.priorNote?.sgstPaise ?? 0n,
        igstPaise: original.priorNote?.igstPaise ?? 0n,
      },
      amountPaise,
    })),
  });

  if (!calculated.ok) {
    throw badRequest(
      "NOTE_EXCEEDS_SOURCE",
      `The note exceeds what remains of "${selected[calculated.index]?.original.description}".`,
    );
  }

  const lines: PostDocumentLine[] = selected.map(({ original }, index) => {
    const tax = nth(calculated.lines, index, "note line tax");

    return {
      ...accountLine(original.accountId, original.description, tax.taxablePaise),
      sourceLineId: original.id,
      hsnSac: original.hsnSac,
      taxRateId: original.taxRateId,
      itcEligible: input.type === "debitNote" ? original.itcEligible : null,
      cgstPaise: tax.cgstPaise,
      sgstPaise: tax.sgstPaise,
      igstPaise: tax.igstPaise,
    };
  });

  const totals = documentTotals(lines);

  if (totals.totalPaise === 0n)
    throw badRequest("NOTE_ZERO_TOTAL", "A note must have a positive total.");

  if (source.prior.totalPaise + totals.totalPaise > source.totalPaise) {
    throw badRequest("NOTE_EXCEEDS_SOURCE", "Note total exceeds the source document total.");
  }

  const tdsPaise =
    input.type === "debitNote" && source.tds
      ? noteTdsReversal({
          billTdsPaise: source.tds.amountPaise,
          billTaxablePaise: source.tds.basePaise,
          priorTaxablePaise: source.prior.taxablePaise,
          priorReversedPaise: source.prior.reversedTdsPaise,
          taxablePaise: totals.taxablePaise,
        })
      : 0n;

  if (tdsPaise > totals.totalPaise)
    throw badRequest("NOTE_TDS_EXCEEDS_TOTAL", "TDS reversal cannot exceed the note total.");

  return { source, lines, totals, tdsPaise };
}

export const noteRouter = {
  // The note form's live figures come from the same resolution that posts, and write nothing.
  quote: orgProcedure({ note: ["post"] }, quoteInput).handler(async ({ context, input }) => {
    const { lines, totals, tdsPaise } = await resolveNote(db, context.scope.orgId, input);

    return {
      lines: lines.map((line) => {
        const {
          sourceLineId,
          amountPaise,
          cgstPaise,
          sgstPaise,
          igstPaise,
          taxPaise,
          lineTotalPaise,
        } = withLineTax(line);

        return {
          sourceLineId,
          amountPaise,
          cgstPaise,
          sgstPaise,
          igstPaise,
          taxPaise,
          lineTotalPaise,
        };
      }),
      ...totals,
      tdsPaise,
      // What settles with the party once the TDS reversal is set aside.
      netPaise: totals.totalPaise - tdsPaise,
    };
  }),

  post: orgProcedure({ note: ["post"] }, postInput).handler(async ({ context, input }) => {
    const { scope } = context;

    const posted = await db.transaction(async (tx) => {
      const settings = await orgSettings(scope.orgId, tx);
      const { source, lines, totals, tdsPaise } = await resolveNote(tx, scope.orgId, input);
      const { partyId } = source;

      const documentDate = input.documentDate ?? businessDate(new Date(), settings.timeZone);

      if (documentDate < source.documentDate) {
        throw badRequest(
          "NOTE_DATE_BEFORE_SOURCE",
          "Note date cannot precede its source document.",
        );
      }

      const posting: CreditNotePosting | DebitNotePosting =
        input.type === "creditNote"
          ? {
              type: "creditNote",
              exposureSide: "receivable",
              partyId,
              amountPaise: totals.totalPaise,
              lines: lines.map((line) => {
                if (!line.accountId)
                  throw impossible(`source line ${line.sourceLineId} has no account`);

                return { accountId: line.accountId, amountPaise: line.amountPaise };
              }),
              cgstPaise: totals.cgstPaise,
              sgstPaise: totals.sgstPaise,
              igstPaise: totals.igstPaise,
              roundOffPaise: totals.roundOffPaise,
            }
          : {
              type: "debitNote",
              exposureSide: "payable",
              partyId,
              amountPaise: totals.totalPaise,
              ...purchaseLegs(lines),
              roundOffPaise: totals.roundOffPaise,
              tdsPaise,
            };

      const [party] = await tx
        .select()
        .from(parties)
        .where(and(eq(parties.orgId, scope.orgId), eq(parties.id, partyId)));

      if (!party) throw impossible(`source ${source.id} has no party`);

      return postDocument(
        tx,
        scope,
        settings,
        input.type === "creditNote" ? settings.creditNotePrefix : settings.debitNotePrefix,
        {
          documentDate,
          dueDate: null,
          placeOfSupplyStateCode: source.placeOfSupplyStateCode,
          intraState: source.intraState,
          reference: input.type === "debitNote" ? input.reference || null : null,
          narration: input.narration,
          discountPaise: 0n,
          againstDocumentId: source.id,
          tdsSectionId: input.type === "debitNote" ? source.tds?.tdsSectionId : null,
          affectsTax: source.affectsTax,
          printSnapshot: {
            organization: organizationSnapshot(settings),
            party: partySnapshot(party),
            lines: lines.map(({ description }) => ({ description })),
          },
          lines,
          posting,
          draft: null,
        },
      );
    });

    audit({
      action: `${input.type}.post`,
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `${input.type}:${posted.id}`,
      meta: { number: posted.number, againstDocumentId: input.againstDocumentId },
    });

    return posted;
  }),

  get: orgProcedure({ note: ["read"] }, orgInput.extend({ noteId: z.uuid() })).handler(
    async ({ context, input }) => {
      const { orgId } = context.scope;

      const [note] = await db
        .select({
          ...getTableColumns(documents),
          type: noteTypeColumn,
          unappliedPaise: settlementPaise(orgId, "source", null).balancePaise,
        })
        .from(documents)
        .where(
          and(
            eq(documents.orgId, orgId),
            eq(documents.id, input.noteId),
            inArray(documents.type, [...NOTE_TYPES]),
          ),
        )
        .limit(1);

      if (!note) throw new ORPCError("NOT_FOUND", { message: "Note not found." });

      if (!note.againstDocumentId) throw impossible(`note ${note.id} has no source`);

      const [lines, [source], allocations, [tds]] = await Promise.all([
        db
          .select({ ...getTableColumns(documentLines), rateBasisPoints: taxRates.rateBasisPoints })
          .from(documentLines)
          .leftJoin(
            taxRates,
            and(eq(taxRates.orgId, orgId), eq(taxRates.id, documentLines.taxRateId)),
          )
          .where(and(eq(documentLines.orgId, orgId), eq(documentLines.documentId, note.id)))
          .orderBy(asc(documentLines.position)),
        db
          .select({
            id: against.id,
            type: against.type,
            number: against.number,
            documentDate: against.documentDate,
            reference: against.reference,
            printSnapshot: against.printSnapshot,
          })
          .from(against)
          .where(and(eq(against.orgId, orgId), eq(against.id, note.againstDocumentId)))
          .limit(1),
        allocationsOf(db, orgId, note.id, "source"),
        db
          .select({ amountPaise: tdsDeductions.amountPaise })
          .from(tdsDeductions)
          .where(and(eq(tdsDeductions.orgId, orgId), eq(tdsDeductions.documentId, note.id)))
          .limit(1),
      ]);

      const tdsReversedPaise = tds?.amountPaise ?? 0n;

      return {
        ...note,
        lines: lines.map(withLineTax),
        totals: taxTotals(lines),
        against: source ?? null,
        allocations,
        tdsReversedPaise,
        // What settles with the party once the TDS reversal is set aside.
        netPaise: note.totalPaise - tdsReversedPaise,
        // A cancelled note keeps its capacity row but settles nothing.
        unappliedPaise: note.state === "posted" ? note.unappliedPaise : 0n,
      };
    },
  ),

  list: orgProcedure(
    { note: ["read"] },
    orgInput
      .extend({ ...documentListFields, type: noteType.optional() })
      .superRefine(orderedPeriod),
  ).handler(async ({ context, input }) => {
    const { orgId } = context.scope;

    const { rows, nextCursor } = await registerPage(
      orgId,
      input.type ? [input.type] : NOTE_TYPES,
      input,
      (listed) =>
        db
          .select({
            id: documents.id,
            type: noteTypeColumn,
            number: documents.number,
            documentDate: documents.documentDate,
            state: documents.state,
            totalPaise: documents.totalPaise,
            partyName: printedPartyName,
            againstDocumentId: documents.againstDocumentId,
            againstNumber: against.number,
            unappliedPaise: settlementPaise(orgId, "source", null).balancePaise,
          })
          .from(documents)
          .leftJoin(
            against,
            and(eq(against.orgId, orgId), eq(against.id, documents.againstDocumentId)),
          )
          .where(listed)
          .orderBy(desc(documents.documentDate), desc(documents.id))
          .limit(input.limit + 1),
    );

    return {
      rows: rows.map((row) => ({
        ...row,
        unappliedPaise: row.state === "posted" ? row.unappliedPaise : 0n,
      })),
      nextCursor,
    };
  }),

  cancel: orgProcedure({ note: ["cancel"] }, orgInput.extend({ noteId: z.uuid(), reason })).handler(
    ({ context, input }) =>
      cancelDocument(context.scope, ["creditNote", "debitNote"], input.noteId, input.reason),
  ),
};
