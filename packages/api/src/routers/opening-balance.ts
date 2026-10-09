import { db } from "@accly/db";
import { documents } from "@accly/db/schema/documents";
import { parties } from "@accly/db/schema/parties";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { audit } from "@accly/db/audit";
import { settlementPaise } from "../core/allocations";
import { postedNumber } from "../core/documents";
import { entryLinesOf, postEntryLines } from "../core/entry-lines";
import { formatDecimal } from "../core/money";
import { OPENING_BALANCE_PREFIX } from "../core/number-prefixes";
import { assertNoOpeningBalance, reverseOpening } from "../core/opening-items";
import { businessDate } from "../lib/business-date";
import { badRequest, impossible } from "../lib/conflict";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import {
  balancedEntryLines,
  dateOnly,
  documentCursor,
  entryLineFields,
  pageLimit,
  reason,
} from "../lib/schemas";
import { cancelDocument } from "../lib/settlements";
import { orgSettings } from "../lib/org-settings";
import { dateCursor, documentCursorOf, pageOf } from "../lib/pagination";

const lineSchema = z.strictObject(entryLineFields);

const postInput = z
  .strictObject({
    ...orgInput.shape,
    documentDate: dateOnly,
    lines: z.array(lineSchema).min(2).max(100),
  })
  .superRefine(balancedEntryLines);

export const openingBalanceRouter = {
  post: orgProcedure({ openingBalance: ["post"] }, postInput).handler(
    async ({ context, input }) => {
      const { scope } = context;

      const posted = await db.transaction(async (tx) => {
        const settings = await orgSettings(scope.orgId, tx, "update");

        if (input.documentDate > businessDate(new Date(), settings.timeZone)) {
          throw badRequest(
            "OPENING_BALANCE_DATE_FUTURE",
            "Choose the day before your cutover, not a future date.",
          );
        }

        await assertNoOpeningBalance(tx, scope.orgId);

        return postEntryLines(tx, scope, settings, {
          type: "openingBalance",
          prefix: OPENING_BALANCE_PREFIX,
          documentDate: input.documentDate,
          narration: "Opening balances",
          reference: null,
          controls: [],
          lines: input.lines,
        });
      });

      audit({
        action: "openingBalance.post",
        actorId: scope.userId,
        orgId: scope.orgId,
        target: `openingBalance:${posted.id}`,
        meta: {
          number: posted.number,
          amount: formatDecimal(posted.amountPaise),
          lines: input.lines.length,
        },
      });

      return { id: posted.id, number: posted.number };
    },
  ),

  get: orgProcedure({ openingBalance: ["read"] }, orgInput).handler(async ({ context }) => {
    const { orgId } = context.scope;

    const header = await db
      .select({
        id: documents.id,
        number: documents.number,
        documentDate: documents.documentDate,
        totalPaise: documents.totalPaise,
        postedAt: documents.postedAt,
      })
      .from(documents)
      .where(
        and(
          eq(documents.orgId, orgId),
          eq(documents.type, "openingBalance"),
          eq(documents.state, "posted"),
        ),
      )
      .limit(1)
      .then(([row]) => row);

    if (!header) return null;

    if (header.postedAt === null) {
      throw impossible(`posted opening balance ${header.id} has no posting instant`);
    }

    const lines = await entryLinesOf(orgId, header.id);

    return {
      id: header.id,
      number: postedNumber(header.number, header.id),
      documentDate: header.documentDate,
      totalPaise: header.totalPaise,
      postedAt: header.postedAt,
      lines,
    };
  }),

  // The posted opening items, oldest legacy date first, one keyset page at a time,
  // each with what remains open.
  items: orgProcedure(
    { openingBalance: ["read"] },
    orgInput.extend({ cursor: documentCursor.optional(), limit: pageLimit }),
  ).handler(async ({ context, input }) => {
    const { orgId } = context.scope;
    const claim = settlementPaise(orgId, "target", null).balancePaise;
    const credit = settlementPaise(orgId, "source", null).balancePaise;

    const rows = await db
      .select({
        id: documents.id,
        type: documents.type,
        number: documents.number,
        partyId: parties.id,
        partyName: parties.name,
        exposureSide: documents.exposureSide,
        reference: documents.reference,
        documentDate: documents.documentDate,
        dueDate: documents.dueDate,
        totalPaise: documents.totalPaise,
        // CASE runs only the taken branch's subqueries.
        balancePaise:
          sql<bigint>`case when ${documents.type} = 'openingClaim' then ${claim} else ${credit} end`.mapWith(
            BigInt,
          ),
      })
      .from(documents)
      .innerJoin(parties, and(eq(parties.orgId, orgId), eq(parties.id, documents.partyId)))
      .where(
        and(
          eq(documents.orgId, orgId),
          inArray(documents.type, ["openingClaim", "openingCredit"]),
          eq(documents.state, "posted"),
          dateCursor(input.cursor, "after"),
        ),
      )
      .orderBy(asc(documents.documentDate), asc(documents.id))
      .limit(input.limit + 1);

    const page = pageOf(rows, input.limit, documentCursorOf);

    return {
      nextCursor: page.nextCursor,
      rows: page.rows.map((item) => {
        if (item.exposureSide === null || item.reference === null)
          throw impossible(`opening item ${item.id} lacks its side or reference`);

        return {
          ...item,
          // SAFETY: the query keeps only the two opening item types.
          type: item.type as "openingClaim" | "openingCredit",
          exposureSide: item.exposureSide,
          reference: item.reference,
          number: postedNumber(item.number, item.id),
        };
      }),
    };
  }),

  cancel: orgProcedure(
    { openingBalance: ["cancel"] },
    orgInput.extend({ openingBalanceId: z.uuid(), reason }),
  ).handler(({ context, input }) =>
    cancelDocument(
      context.scope,
      ["openingBalance"],
      input.openingBalanceId,
      input.reason,
      reverseOpening,
    ),
  ),
};
