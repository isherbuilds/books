import { db } from "@accly/db";
import { documents } from "@accly/db/schema/documents";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { postedNumber } from "../core/documents";
import { entryLinesOf, postEntryLines } from "../core/entry-lines";
import { formatDecimal } from "../core/money";
import { impossible } from "../lib/conflict";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { balancedEntryLines, dateOnly, entryLineFields, reason } from "../lib/schemas";
import { cancelDocument, orgSettings } from "../lib/settlements";

const OPENING_BALANCE_PREFIX = "OB";

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

        const [existing] = await tx
          .select({ id: documents.id, number: documents.number })
          .from(documents)
          .where(
            and(
              eq(documents.orgId, scope.orgId),
              eq(documents.type, "openingBalance"),
              eq(documents.state, "posted"),
            ),
          )
          .limit(1);

        if (existing) {
          throw new ORPCError("CONFLICT", {
            message: `Opening balance ${postedNumber(existing.number, existing.id)} is already posted. Cancel it first.`,
          });
        }

        // The partial unique index remains the final guarantee if another write path is added.
        return postEntryLines(tx, scope, settings, {
          type: "openingBalance",
          prefix: OPENING_BALANCE_PREFIX,
          documentDate: input.documentDate,
          narration: "Opening balances",
          reference: null,
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
        createdAt: documents.createdAt,
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
      createdAt: header.createdAt,
      lines,
    };
  }),

  cancel: orgProcedure(
    { openingBalance: ["cancel"] },
    orgInput.extend({ openingBalanceId: z.uuid(), reason }),
  ).handler(({ context, input }) =>
    cancelDocument(context.scope, "openingBalance", input.openingBalanceId, input.reason),
  ),
};
