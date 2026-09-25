import { authorize } from "@accly/auth/access";
import { db } from "@accly/db";
import { documentLines } from "@accly/db/schema/document-lines";
import { documents } from "@accly/db/schema/documents";
import { tdsDeductions } from "@accly/db/schema/tds-deductions";
import { tdsSections } from "@accly/db/schema/tds-sections";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { settlementPaise } from "../core/allocations";
import {
  accountLine,
  organizationSnapshot,
  partySnapshot,
  postDocument,
  type PostDocumentInput,
  type PostDocumentLine,
} from "../core/documents";
import { formatDecimal, sumPaise } from "../core/money";
import { computeTds } from "../core/posting";
import { postableAccounts } from "../lib/accounts";
import { businessDate } from "../lib/business-date";
import { badRequest } from "../lib/conflict";
import { activeParty } from "../lib/parties";
import { effectiveOn } from "../core/tax-schedule";
import { orgInput, orgProcedure, requirePermission } from "../lib/procedures/factory";
import {
  dateOnly,
  orderedPeriod,
  positiveMoney,
  reason,
  settlementListFields,
  settlementPostFields,
} from "../lib/schemas";
import {
  allocationsOf,
  cancelDocument,
  listSettlements,
  orgSettings,
  orgTimeZone,
  settlementDetail,
} from "../lib/settlements";

const commonPostFields = { ...orgInput.shape, ...settlementPostFields };

const postInput = z.union([
  z.strictObject({
    ...commonPostFields,
    settlementKind: z.literal("advance"),
    partyId: z.uuid(),
    tdsSectionId: z.uuid().optional(),
  }),
  z.strictObject({
    ...commonPostFields,
    settlementKind: z.literal("direct"),
    partyId: z.uuid().optional(),
    expenseAccountId: z.uuid(),
    tdsSectionId: z.uuid().optional(),
  }),
  z.strictObject({
    ...commonPostFields,
    settlementKind: z.literal("against"),
    exposureSide: z.literal("payable"),
    partyId: z.uuid(),
    allocations: z
      .array(z.strictObject({ billId: z.uuid(), amount: positiveMoney }))
      .min(1)
      .max(50),
    writeOffs: z
      .array(z.strictObject({ accountId: z.uuid(), amount: positiveMoney }))
      .max(5)
      .optional(),
    fee: z.strictObject({ accountId: z.uuid(), amount: positiveMoney }).optional(),
  }),
  z.strictObject({
    ...commonPostFields,
    settlementKind: z.literal("against"),
    exposureSide: z.literal("receivable"),
    partyId: z.uuid(),
    allocations: z
      .array(z.strictObject({ creditNoteId: z.uuid(), amount: positiveMoney }))
      .min(1)
      .max(50),
  }),
]);

export const paymentRouter = {
  post: orgProcedure({ payment: ["post"] }, postInput).handler(async ({ context, input }) => {
    const { scope } = context;
    const { settlementKind } = input;
    const tdsSectionId = "tdsSectionId" in input ? input.tdsSectionId : undefined;

    // Settling a claim needs read access to it: bills for a payable, credit notes for a refund.
    if (settlementKind === "against") {
      requirePermission(
        scope,
        input.exposureSide === "payable" ? { bill: ["read"] } : { note: ["read"] },
      );
    }

    if (
      settlementKind === "against" &&
      input.exposureSide === "receivable" &&
      sumPaise(input.allocations.map((allocation) => allocation.amount)) !== input.amount
    ) {
      throw badRequest(
        "REFUND_AMOUNT_MISMATCH",
        "Refund amount must equal the allocated credit notes.",
      );
    }

    const { posted, tds, section } = await db.transaction(async (tx) => {
      const settings = await orgSettings(scope.orgId, tx);
      const documentDate = input.documentDate ?? businessDate(new Date(), settings.timeZone);

      const party = input.partyId ? await activeParty(tx, scope.orgId, input.partyId) : null;

      const accountIds =
        settlementKind === "direct"
          ? [input.expenseAccountId]
          : settlementKind === "against" && input.exposureSide === "payable"
            ? [
                ...(input.writeOffs ?? []).map(({ accountId }) => accountId),
                ...(input.fee ? [input.fee.accountId] : []),
              ]
            : [];

      const validAccounts = await postableAccounts(tx, scope.orgId, accountIds, [
        "expense",
        "income",
        "asset",
      ]);

      const byAccountId = new Map(validAccounts.map((account) => [account.id, account]));

      const expenseAccount =
        settlementKind === "direct" ? byAccountId.get(input.expenseAccountId) : null;

      const [section] = tdsSectionId
        ? await tx
            .select()
            .from(tdsSections)
            .where(
              and(
                eq(tdsSections.orgId, scope.orgId),
                eq(tdsSections.id, tdsSectionId),
                effectiveOn(tdsSections, documentDate),
              ),
            )
            .limit(1)
            .for("share")
        : [];

      if (input.partyId && !party) {
        throw badRequest("PARTY_INVALID", "Choose a party in this organization.");
      }

      if (tdsSectionId && !section) {
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
      let lines: PostDocumentLine[];

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
        lines = [accountLine(null, lineDescription, input.amount)];
      } else if (settlementKind === "against") {
        lineDescription =
          input.narration ??
          (input.exposureSide === "payable" ? "Payment against bills" : "Credit note refund");
        lines = [accountLine(null, lineDescription, input.amount)];

        if (input.exposureSide === "payable") {
          const writeOffs = (input.writeOffs ?? []).map(({ accountId, amount }) => {
            const account = byAccountId.get(accountId);

            if (account?.type !== "income" && account?.type !== "expense") {
              throw badRequest(
                "ACCOUNT_INVALID",
                "Choose an active income or expense leaf for a write-off.",
              );
            }

            const line = accountLine(accountId, "Write-off", amount);
            line.adjustmentKind = "writeOff";
            lines.push(line);

            return { accountId, amountPaise: amount };
          });

          if (input.fee) {
            if (byAccountId.get(input.fee.accountId)?.type !== "expense") {
              throw badRequest("ACCOUNT_INVALID", "Choose an active expense leaf for the fee.");
            }

            const line = accountLine(input.fee.accountId, "Payment fee", input.fee.amount);
            line.adjustmentKind = "fee";
            lines.push(line);
          }

          posting = {
            paymentMethodId: input.paymentMethodId,
            type: "payment",
            settlementKind,
            exposureSide: "payable",
            partyId: input.partyId,
            accountId: null,
            amountPaise: input.amount,
            tds: null,
            allocations: input.allocations.map(({ billId, amount }) => ({
              documentId: billId,
              amountPaise: amount,
            })),
            writeOffs,
            fee: input.fee
              ? { accountId: input.fee.accountId, amountPaise: input.fee.amount }
              : null,
          };
        } else {
          posting = {
            paymentMethodId: input.paymentMethodId,
            type: "payment",
            settlementKind,
            exposureSide: "receivable",
            partyId: input.partyId,
            accountId: null,
            amountPaise: input.amount,
            tds: null,
            sources: input.allocations.map(({ creditNoteId, amount }) => ({
              documentId: creditNoteId,
              amountPaise: amount,
            })),
          };
        }
      } else {
        if (!expenseAccount || !["expense", "asset"].includes(expenseAccount.type)) {
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
        lines = [accountLine(expenseAccount.id, lineDescription, input.amount)];
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
        discountPaise: 0n,
        againstDocumentId: null,
        narration: input.narration ?? null,
        affectsTax: false,
        printSnapshot,
        lines,
        posting,
        draft: null,
      });

      return { posted, tds, section };
    });

    audit({
      action: "payment.post",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `payment:${posted.id}`,
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

      const detail = await settlementDetail(orgId, "payment", input.paymentId);
      // A refund settles from credit notes; every other non-direct payment is a source
      // that settles bills, at post or later from an advance.
      const isRefund = detail.exposureSide === "receivable";
      const settles = detail.settlementKind !== "direct";

      const canReadRelated =
        !settles ||
        authorize(context.scope.roles, isRefund ? { note: ["read"] } : { bill: ["read"] });

      const [allocations, adjustments, [tds], [credit]] = await Promise.all([
        settles && canReadRelated
          ? allocationsOf(db, orgId, input.paymentId, isRefund ? "target" : "source")
          : Promise.resolve([]),
        db
          .select({
            id: documentLines.id,
            accountId: documentLines.accountId,
            adjustmentKind: documentLines.adjustmentKind,
            amountPaise: documentLines.amountPaise,
          })
          .from(documentLines)
          .where(
            and(
              eq(documentLines.orgId, orgId),
              eq(documentLines.documentId, input.paymentId),
              isNotNull(documentLines.adjustmentKind),
            ),
          )
          .orderBy(asc(documentLines.position)),
        db
          .select({
            code: tdsSections.code,
            description: tdsSections.description,
            rateBasisPoints: tdsSections.rateBasisPoints,
            basePaise: tdsDeductions.basePaise,
            amountPaise: tdsDeductions.amountPaise,
          })
          .from(tdsDeductions)
          .innerJoin(
            tdsSections,
            and(eq(tdsSections.orgId, orgId), eq(tdsSections.id, tdsDeductions.tdsSectionId)),
          )
          .where(and(eq(tdsDeductions.orgId, orgId), eq(tdsDeductions.documentId, input.paymentId)))
          .limit(1),
        settles && !isRefund
          ? db
              .select({ unappliedPaise: settlementPaise(orgId, "source").balancePaise })
              .from(documents)
              .where(and(eq(documents.orgId, orgId), eq(documents.id, input.paymentId)))
          : Promise.resolve([]),
      ]);

      return {
        ...detail,
        allocations: canReadRelated ? allocations : null,
        adjustments,
        tds: tds ?? null,
        // A cancelled payment keeps its capacity row but settles nothing.
        unappliedPaise: credit ? (detail.state === "posted" ? credit.unappliedPaise : 0n) : null,
      };
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
    cancelDocument(context.scope, ["payment"], input.paymentId, input.reason),
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
      .where(and(eq(tdsSections.orgId, context.scope.orgId), effectiveOn(tdsSections, date)))
      .orderBy(tdsSections.code);
  }),
};
