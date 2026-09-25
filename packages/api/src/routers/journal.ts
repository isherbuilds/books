import { db } from "@accly/db";
import { documents } from "@accly/db/schema/documents";
import { ORPCError } from "@orpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { postedNumber } from "../core/documents";
import { entryLinesOf, postEntryLines } from "../core/entry-lines";
import { formatDecimal } from "../core/money";
import { journalAccounts } from "../lib/accounts";
import { capMasterList } from "../lib/master-list";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import {
  balancedEntryLines,
  dateOnly,
  documentPageFields,
  entryLineFields,
  orderedPeriod,
  reason,
  settlementPostFields,
} from "../lib/schemas";
import { cancelDocument, documentListWhere, orgSettings, pageOf } from "../lib/settlements";

const lineSchema = z.strictObject({
  ...entryLineFields,
  partyId: z.uuid().optional(),
});

const postInput = z
  .strictObject({
    ...orgInput.shape,
    documentDate: dateOnly,
    narration: z.string().trim().min(1).max(500),
    reference: settlementPostFields.reference,
    lines: z.array(lineSchema).min(2).max(100),
  })
  .superRefine(balancedEntryLines);

export const journalRouter = {
  post: orgProcedure({ journal: ["post"] }, postInput).handler(async ({ context, input }) => {
    const { scope } = context;

    const posted = await db.transaction(async (tx) => {
      const settings = await orgSettings(scope.orgId, tx);

      return postEntryLines(tx, scope, settings, {
        type: "journal",
        prefix: settings.journalPrefix,
        documentDate: input.documentDate,
        narration: input.narration,
        reference: input.reference ?? null,
        lines: input.lines,
      });
    });

    audit({
      action: "journal.post",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `journal:${posted.id}`,
      meta: {
        number: posted.number,
        amount: formatDecimal(posted.amountPaise),
        lines: input.lines.length,
      },
    });

    return { id: posted.id, number: posted.number };
  }),

  get: orgProcedure({ journal: ["read"] }, orgInput.extend({ journalId: z.uuid() })).handler(
    async ({ context, input }) => {
      const { orgId } = context.scope;

      const header = await db
        .select({
          id: documents.id,
          number: documents.number,
          state: documents.state,
          documentDate: documents.documentDate,
          reference: documents.reference,
          narration: documents.narration,
          totalPaise: documents.totalPaise,
          cancelledAt: documents.cancelledAt,
        })
        .from(documents)
        .where(
          and(
            eq(documents.orgId, orgId),
            eq(documents.id, input.journalId),
            eq(documents.type, "journal"),
          ),
        )
        .limit(1)
        .then(([row]) => row);

      if (!header) throw new ORPCError("NOT_FOUND", { message: "Journal not found." });

      // Only after the type check: a non-journal document's lines carry no entry side.
      const lines = await entryLinesOf(orgId, header.id);

      return {
        ...header,
        number: postedNumber(header.number, header.id),
        lines,
      };
    },
  ),

  list: orgProcedure(
    { journal: ["read"] },
    orgInput
      .extend({
        // `partyId` is omitted: a Journal's header party is null (parties sit on lines),
        // so the shared header filter would match nothing.
        ...documentPageFields,
        state: z.enum(["posted", "cancelled"]).optional(),
      })
      .superRefine(orderedPeriod),
  ).handler(async ({ context, input }) => {
    const { orgId } = context.scope;

    const queried = await db
      .select({
        id: documents.id,
        number: documents.number,
        documentDate: documents.documentDate,
        state: documents.state,
        totalPaise: documents.totalPaise,
        reference: documents.reference,
        narration: documents.narration,
      })
      .from(documents)
      .where(
        and(
          documentListWhere(orgId, ["journal"], input),
          input.state ? eq(documents.state, input.state) : undefined,
        ),
      )
      .orderBy(desc(documents.id))
      .limit(input.limit + 1);

    const page = pageOf(queried, input.limit);

    return {
      ...page,
      rows: page.rows.map((row) => ({
        ...row,
        number: postedNumber(row.number, row.id),
      })),
    };
  }),

  accounts: orgProcedure({ journal: ["read"] }, orgInput).handler(async ({ context }) => {
    const { orgId } = context.scope;
    const settings = await orgSettings(orgId);

    return capMasterList(await journalAccounts(db, orgId, { gstin: settings.gstin }));
  }),

  cancel: orgProcedure(
    { journal: ["cancel"] },
    orgInput.extend({ journalId: z.uuid(), reason }),
  ).handler(({ context, input }) =>
    cancelDocument(context.scope, ["journal"], input.journalId, input.reason),
  ),
};
