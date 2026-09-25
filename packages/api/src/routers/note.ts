import { db } from "@accly/db";
import { documentLines } from "@accly/db/schema/document-lines";
import { documents } from "@accly/db/schema/documents";
import { parties } from "@accly/db/schema/parties";
import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { audit } from "../audit";
import { settlementPaise } from "../core/allocations";
import {
  accountLine,
  documentTotals,
  noteSource,
  organizationSnapshot,
  partySnapshot,
  postDocument,
  purchaseLegs,
  type PostDocumentLine,
} from "../core/documents";
import { computeNoteLines } from "../core/note-lines";
import type { CreditNotePosting, DebitNotePosting } from "../core/posting";
import { businessDate } from "../lib/business-date";
import { badRequest, impossible } from "../lib/conflict";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { dateOnly, documentListFields, orderedPeriod, positiveMoney, reason } from "../lib/schemas";
import {
  allocationsOf,
  cancelDocument,
  documentListWhere,
  orgSettings,
  pageOf,
  printedPartyName,
} from "../lib/settlements";

const NOTE_TYPES = ["creditNote", "debitNote"] as const;

const noteType = z.enum(NOTE_TYPES);

// Both reads filter to notes, so the column narrows to the two note types.
const noteTypeColumn = sql<(typeof NOTE_TYPES)[number]>`${documents.type}`;

const postInput = orgInput
  .extend({
    type: noteType,
    againstDocumentId: z.uuid(),
    documentDate: dateOnly.optional(),
    narration: reason,
    lines: z
      .array(z.object({ sourceLineId: z.uuid(), amount: positiveMoney }))
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((input, context) => {
    const seen = new Set<string>();
    input.lines.forEach((line, index) => {
      if (seen.has(line.sourceLineId))
        context.addIssue({
          code: "custom",
          path: ["lines", index, "sourceLineId"],
          message: "Choose each source line once.",
        });
      seen.add(line.sourceLineId);
    });
  });

const against = alias(documents, "note_against");

export const noteRouter = {
  post: orgProcedure({ note: ["post"] }, postInput).handler(async ({ context, input }) => {
    const { scope } = context;

    const posted = await db.transaction(async (tx) => {
      const settings = await orgSettings(scope.orgId, tx);
      const source = await noteSource(tx, scope, input.againstDocumentId, input.type);
      const partyId = source.partyId;

      if (!partyId) throw impossible(`source ${source.id} has no party`);
      const documentDate = input.documentDate ?? businessDate(new Date(), settings.timeZone);

      if (documentDate < source.documentDate) {
        throw badRequest(
          "NOTE_DATE_BEFORE_SOURCE",
          "Note date cannot precede its source document.",
        );
      }

      const byId = new Map(source.lines.map((line) => [line.id, line]));
      const prior = new Map(source.prior.map((line) => [line.sourceLineId, line]));

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
            taxablePaise: prior.get(original.id)?.amountPaise ?? 0n,
            cgstPaise: prior.get(original.id)?.cgstPaise ?? 0n,
            sgstPaise: prior.get(original.id)?.sgstPaise ?? 0n,
            igstPaise: prior.get(original.id)?.igstPaise ?? 0n,
          },
          amountPaise,
        })),
      });

      if (!calculated.ok) {
        const { original } = selected[calculated.index]!;

        throw badRequest(
          "NOTE_EXCEEDS_SOURCE",
          `The note exceeds what remains of "${original.description}".`,
        );
      }

      const lines: PostDocumentLine[] = selected.map(({ original }, index) => ({
        ...accountLine(
          original.accountId,
          original.description,
          calculated.lines[index]!.taxablePaise,
        ),
        sourceLineId: original.id,
        hsnSac: original.hsnSac,
        taxRateId: original.taxRateId,
        itcEligible: input.type === "debitNote" ? original.itcEligible : null,
        cgstPaise: calculated.lines[index]!.cgstPaise,
        sgstPaise: calculated.lines[index]!.sgstPaise,
        igstPaise: calculated.lines[index]!.igstPaise,
      }));

      const totals = documentTotals(lines);
      const amountPaise = totals.totalPaise;

      if (amountPaise === 0n)
        throw badRequest("NOTE_ZERO_TOTAL", "A note must have a positive total.");

      if (source.priorTotalPaise + amountPaise > source.totalPaise) {
        throw badRequest("NOTE_EXCEEDS_SOURCE", "Note total exceeds the source document total.");
      }

      const posting: CreditNotePosting | DebitNotePosting =
        input.type === "creditNote"
          ? {
              type: "creditNote",
              exposureSide: "receivable",
              partyId,
              amountPaise,
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
              amountPaise,
              ...purchaseLegs(lines),
              roundOffPaise: totals.roundOffPaise,
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
          reference: null,
          narration: input.narration,
          discountPaise: 0n,
          againstDocumentId: source.id,
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
          unappliedPaise: settlementPaise(orgId, "source").balancePaise,
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

      const [lines, [source], allocations] = await Promise.all([
        db
          .select()
          .from(documentLines)
          .where(and(eq(documentLines.orgId, orgId), eq(documentLines.documentId, note.id)))
          .orderBy(asc(documentLines.position)),
        db
          .select({ id: against.id, type: against.type, number: against.number })
          .from(against)
          .where(and(eq(against.orgId, orgId), eq(against.id, note.againstDocumentId!)))
          .limit(1),
        allocationsOf(db, orgId, note.id, "source"),
      ]);

      return {
        ...note,
        lines,
        against: source ?? null,
        allocations,
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

    const rows = await db
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
        unappliedPaise: settlementPaise(orgId, "source").balancePaise,
      })
      .from(documents)
      .leftJoin(against, and(eq(against.orgId, orgId), eq(against.id, documents.againstDocumentId)))
      .where(documentListWhere(orgId, input.type ? [input.type] : NOTE_TYPES, input))
      .orderBy(desc(documents.id))
      .limit(input.limit + 1);

    return pageOf(
      rows.map((row) => ({
        ...row,
        unappliedPaise: row.state === "posted" ? row.unappliedPaise : 0n,
      })),
      input.limit,
    );
  }),

  cancel: orgProcedure({ note: ["cancel"] }, orgInput.extend({ noteId: z.uuid(), reason })).handler(
    ({ context, input }) =>
      cancelDocument(context.scope, ["creditNote", "debitNote"], input.noteId, input.reason),
  ),
};
