import { db } from "@accly/db";
import { parties } from "@accly/db/schema/parties";
import { tdsDeductions } from "@accly/db/schema/tds-deductions";
import { tdsSections } from "@accly/db/schema/tds-sections";
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import {
  accountLine,
  organizationSnapshot,
  partySnapshot,
  postDocument,
  type PostDocumentInput,
} from "../core/documents";
import { formatDecimal } from "../core/money";
import { computeTds } from "../core/posting";
import { postableAccount } from "../lib/accounts";
import { businessDate } from "../lib/business-date";
import { badRequest } from "../lib/conflict";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import {
  dateOnly,
  orderedPeriod,
  reason,
  settlementListFields,
  settlementPostFields,
} from "../lib/schemas";
import {
  cancelDocument,
  listSettlements,
  orgSettings,
  orgTimeZone,
  settlementDetail,
} from "../lib/settlements";

const postInput = z.discriminatedUnion("settlementKind", [
  z.strictObject({
    ...orgInput.shape,
    ...settlementPostFields,
    settlementKind: z.literal("advance"),
    partyId: z.uuid(),
    tdsSectionId: z.uuid().optional(),
  }),
  z.strictObject({
    ...orgInput.shape,
    ...settlementPostFields,
    settlementKind: z.literal("direct"),
    partyId: z.uuid().optional(),
    expenseAccountId: z.uuid(),
    tdsSectionId: z.uuid().optional(),
  }),
]);

export const paymentRouter = {
  post: orgProcedure({ payment: ["post"] }, postInput).handler(async ({ context, input }) => {
    const { scope } = context;
    const { settlementKind } = input;

    const { posted, tds, section } = await db.transaction(async (tx) => {
      const settings = await orgSettings(scope.orgId, tx);
      const documentDate = input.documentDate ?? businessDate(new Date(), settings.timeZone);

      const [party] = input.partyId
        ? await tx
            .select()
            .from(parties)
            .where(
              and(
                eq(parties.orgId, scope.orgId),
                eq(parties.id, input.partyId),
                eq(parties.active, true),
              ),
            )
            .limit(1)
            .for("share")
        : [];

      const expenseAccount =
        settlementKind === "direct"
          ? await postableAccount(tx, scope.orgId, input.expenseAccountId, ["expense", "asset"])
          : undefined;

      const [section] = input.tdsSectionId
        ? await tx
            .select()
            .from(tdsSections)
            .where(and(eq(tdsSections.orgId, scope.orgId), eq(tdsSections.id, input.tdsSectionId)))
            .limit(1)
            .for("share")
        : [];

      if (input.partyId && !party) {
        throw badRequest("PARTY_INVALID", "Choose a party in this organization.");
      }

      if (
        input.tdsSectionId &&
        (!section ||
          section.effectiveFrom > documentDate ||
          (section.effectiveTo !== null && documentDate > section.effectiveTo))
      ) {
        throw badRequest("TDS_SECTION_INVALID", "Choose a TDS section effective on this date.");
      }

      if (section) {
        if (!party) {
          throw badRequest("TDS_PARTY_REQUIRED", "Choose the party whose TDS is deducted.");
        }

        // Without a PAN the law requires a higher rate, which is not modelled; refuse rather
        // than under-deduct at the section rate.
        if (!party.pan) {
          throw badRequest("TDS_PAN_REQUIRED", "Record the party's PAN before deducting TDS.");
        }
      }

      const tds = section
        ? { sectionId: section.id, amountPaise: computeTds(input.amount, section.rateBasisPoints) }
        : null;

      let lineDescription: string;
      let posting: PostDocumentInput["posting"];

      if (settlementKind === "advance") {
        lineDescription = input.narration ?? "Advance paid";
        posting = {
          paymentMethodId: input.paymentMethodId,
          type: "payment",
          settlementKind,
          exposureSide: "payable",
          partyId: input.partyId,
          accountId: null,
          amountPaise: input.amount,
          tds,
        };
      } else {
        if (!expenseAccount) {
          throw badRequest(
            "EXPENSE_ACCOUNT_INVALID",
            "Choose an active expense or asset account that is not a group, system or money account.",
          );
        }

        lineDescription = input.narration ?? expenseAccount.name;
        posting = {
          paymentMethodId: input.paymentMethodId,
          type: "payment",
          settlementKind,
          exposureSide: null,
          partyId: party?.id ?? null,
          accountId: expenseAccount.id,
          amountPaise: input.amount,
          tds,
        };
      }

      const printSnapshot = {
        organization: organizationSnapshot(settings),
        party: partySnapshot(party),
        lines: [{ description: lineDescription }],
      };

      const posted = await postDocument(tx, scope, settings, settings.paymentPrefix, {
        documentDate,
        dueDate: null,
        placeOfSupplyStateCode: null,
        reference: input.reference ?? null,
        narration: input.narration ?? null,
        affectsTax: false,
        printSnapshot,
        lines: [accountLine(posting.accountId, lineDescription, posting.amountPaise)],
        posting,
        draft: null,
      });

      return { posted, tds, section };
    });

    audit({
      action: "payment.post",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: posted.id,
      meta: {
        number: posted.number,
        amount: formatDecimal(input.amount),
        settlementKind,
        tds: formatDecimal(tds?.amountPaise ?? 0n),
        code: section?.code ?? null,
      },
    });

    return posted;
  }),

  get: orgProcedure({ payment: ["read"] }, orgInput.extend({ paymentId: z.uuid() })).handler(
    async ({ context, input }) => {
      const { orgId } = context.scope;

      const [detail, [tds]] = await Promise.all([
        settlementDetail(orgId, "payment", input.paymentId),
        db
          .select({
            code: tdsSections.code,
            description: tdsSections.description,
            rateBasisPoints: tdsSections.rateBasisPoints,
            amountPaise: tdsDeductions.amountPaise,
          })
          .from(tdsDeductions)
          .innerJoin(
            tdsSections,
            and(eq(tdsSections.orgId, orgId), eq(tdsSections.id, tdsDeductions.tdsSectionId)),
          )
          .where(and(eq(tdsDeductions.orgId, orgId), eq(tdsDeductions.documentId, input.paymentId)))
          .limit(1),
      ]);

      return { ...detail, tds: tds ?? null };
    },
  ),

  list: orgProcedure(
    { payment: ["read"] },
    orgInput.extend(settlementListFields).superRefine(orderedPeriod),
  ).handler(({ context, input }) => listSettlements(context.scope.orgId, "payment", input)),

  cancel: orgProcedure(
    { payment: ["cancel"] },
    orgInput.extend({ paymentId: z.uuid(), reason }),
  ).handler(({ context, input }) =>
    cancelDocument(context.scope, "payment", input.paymentId, input.reason),
  ),

  tdsSections: orgProcedure(
    { payment: ["read"] },
    orgInput.extend({ date: dateOnly.optional() }),
  ).handler(async ({ context, input }) => {
    const date = input.date ?? businessDate(new Date(), await orgTimeZone(context.scope.orgId));

    return db
      .select({
        id: tdsSections.id,
        code: tdsSections.code,
        description: tdsSections.description,
        rateBasisPoints: tdsSections.rateBasisPoints,
      })
      .from(tdsSections)
      .where(
        and(
          eq(tdsSections.orgId, context.scope.orgId),
          lte(tdsSections.effectiveFrom, date),
          or(isNull(tdsSections.effectiveTo), gte(tdsSections.effectiveTo, date)),
        ),
      )
      .orderBy(tdsSections.code);
  }),
};
