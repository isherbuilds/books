import { db } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { documentLines, ENTRY_SIDES } from "@accly/db/schema/document-lines";
import { documents } from "@accly/db/schema/documents";
import { parties } from "@accly/db/schema/parties";
import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { accountLine, postDocument, postedNumber, type PostDocumentLine } from "../core/documents";
import { formatDecimal } from "../core/money";
import { journalAccounts } from "../lib/accounts";
import { badRequest, impossible } from "../lib/conflict";
import { capMasterList } from "../lib/master-list";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import {
  dateOnly,
  documentPageFields,
  orderedPeriod,
  positiveMoney,
  reason,
  settlementPostFields,
} from "../lib/schemas";
import { cancelDocument, documentListWhere, orgSettings, pageOf } from "../lib/settlements";

const lineSchema = z.strictObject({
  accountId: z.uuid(),
  side: z.enum(ENTRY_SIDES),
  amount: positiveMoney,
  partyId: z.uuid().optional(),
  description: z
    .string()
    .trim()
    .max(200)
    .transform((value) => value || undefined)
    .optional(),
});

const postInput = z
  .strictObject({
    ...orgInput.shape,
    documentDate: dateOnly,
    narration: z.string().trim().min(1).max(500),
    reference: settlementPostFields.reference,
    lines: z.array(lineSchema).min(2).max(100),
  })
  .superRefine((input, context) => {
    let debitTotal = 0n;
    let creditTotal = 0n;

    for (const line of input.lines) {
      if (line.side === "debit") debitTotal += line.amount;
      else creditTotal += line.amount;
    }

    if (debitTotal === 0n || creditTotal === 0n || debitTotal !== creditTotal) {
      context.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Debits must equal credits.",
      });
    }
  });

export const journalRouter = {
  post: orgProcedure({ journal: ["post"] }, postInput).handler(async ({ context, input }) => {
    const { scope } = context;
    const accountIds = [...new Set(input.lines.map((line) => line.accountId))];

    const partyIds = [
      ...new Set(input.lines.flatMap((line) => (line.partyId === undefined ? [] : [line.partyId]))),
    ];

    let debitTotal = 0n;

    for (const line of input.lines) {
      if (line.side === "debit") debitTotal += line.amount;
    }

    const posted = await db.transaction(async (tx) => {
      const settings = await orgSettings(scope.orgId, tx);

      // One connection runs a transaction's statements in order, so these are sequential
      // by nature; parties are read only once every account has passed.
      const resolvedAccounts = await journalAccounts(tx, scope.orgId, {
        gstin: null,
        ids: accountIds,
      });

      if (resolvedAccounts.length !== accountIds.length) {
        throw badRequest(
          "ACCOUNT_INVALID",
          "Choose active leaf accounts; party control and GST accounts are posted by documents.",
        );
      }

      if (
        settings.gstin !== null &&
        resolvedAccounts.some((account) => account.supplyClass === "taxable")
      ) {
        throw badRequest("TAXABLE_ACCOUNT_LINE", "Taxable income is invoiced, not journaled.");
      }

      const resolvedParties =
        partyIds.length === 0
          ? []
          : await tx
              .select({ id: parties.id })
              .from(parties)
              .where(and(eq(parties.orgId, scope.orgId), inArray(parties.id, partyIds)));

      if (resolvedParties.length !== partyIds.length) {
        throw badRequest("PARTY_INVALID", "Choose a party in this organization.");
      }

      const accountById = new Map(resolvedAccounts.map((account) => [account.id, account]));

      const lines: PostDocumentLine[] = input.lines.map((line) => {
        const account = accountById.get(line.accountId);

        if (!account) throw impossible(`validated journal account ${line.accountId} is missing`);

        return {
          ...accountLine(line.accountId, line.description ?? account.name, line.amount),
          entrySide: line.side,
          partyId: line.partyId ?? null,
        };
      });

      const posting = {
        type: "journal" as const,
        amountPaise: debitTotal,
        lines: input.lines.map((line) => ({
          accountId: line.accountId,
          partyId: line.partyId ?? null,
          side: line.side,
          amountPaise: line.amount,
        })),
      };

      return postDocument(
        tx,
        scope,
        {
          prefix: settings.journalPrefix,
          fiscalYearStartMonth: settings.financialYearStart,
        },
        {
          documentDate: input.documentDate,
          dueDate: null,
          placeOfSupplyStateCode: null,
          reference: input.reference ?? null,
          narration: input.narration,
          affectsTax: false,
          printSnapshot: null,
          lines,
          posting,
          draft: null,
        },
      );
    });

    audit({
      action: "journal.post",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: posted.id,
      meta: {
        number: posted.number,
        amount: formatDecimal(debitTotal),
        lines: input.lines.length,
      },
    });

    return { id: posted.id, number: posted.number };
  }),

  get: orgProcedure({ journal: ["read"] }, orgInput.extend({ journalId: z.uuid() })).handler(
    async ({ context, input }) => {
      const { orgId } = context.scope;

      const [header, rows] = await Promise.all([
        db
          .select({
            id: documents.id,
            number: documents.number,
            state: documents.state,
            documentDate: documents.documentDate,
            reference: documents.reference,
            narration: documents.narration,
            totalPaise: documents.totalPaise,
            postedAt: documents.postedAt,
            cancelledAt: documents.cancelledAt,
            createdAt: documents.createdAt,
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
          .then(([row]) => row),
        db
          .select({
            id: documentLines.id,
            accountId: accounts.id,
            accountName: accounts.name,
            accountCode: accounts.code,
            side: documentLines.entrySide,
            partyId: documentLines.partyId,
            partyName: parties.name,
            description: documentLines.description,
            amountPaise: documentLines.amountPaise,
          })
          .from(documentLines)
          .innerJoin(
            accounts,
            and(eq(accounts.orgId, orgId), eq(accounts.id, documentLines.accountId)),
          )
          .leftJoin(parties, and(eq(parties.orgId, orgId), eq(parties.id, documentLines.partyId)))
          .where(and(eq(documentLines.orgId, orgId), eq(documentLines.documentId, input.journalId)))
          .orderBy(asc(documentLines.position)),
      ]);

      if (!header) throw new ORPCError("NOT_FOUND", { message: "Journal not found." });

      const lines = rows.map((line) => {
        if (line.side === null) {
          throw impossible(`journal line ${line.id} has no entry side`);
        }

        return { ...line, side: line.side };
      });

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
          documentListWhere(orgId, "journal", input),
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
    cancelDocument(context.scope, "journal", input.journalId, input.reason),
  ),
};
