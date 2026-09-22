import { db, type DbTransaction } from "@accly/db";
import { allocations } from "@accly/db/schema/allocations";
import { accounts } from "@accly/db/schema/accounts";
import { documentLines } from "@accly/db/schema/document-lines";
import { DOCUMENT_STATES, documents } from "@accly/db/schema/documents";
import { items } from "@accly/db/schema/items";
import type { organizationSettings } from "@accly/db/schema/organization-settings";
import { parties } from "@accly/db/schema/parties";
import { taxRates } from "@accly/db/schema/tax-rates";
import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import {
  activeAllocationSums,
  allocationReversed,
  invoiceSettlement,
  remainingPaiseOf,
} from "../core/allocations";
import {
  organizationSnapshot,
  partySnapshot,
  postDocument,
  postedNumber,
  writeDraft,
  type DocumentNumbering,
  type PostDocumentInput,
  type PostDocumentLine,
} from "../core/documents";
import { formatDecimal } from "../core/money";
import type { InvoicePosting } from "../core/posting";
import { computeTax, roundOff } from "../core/tax";
import { taxRateEffectiveOn } from "../core/tax-schedule";
import { postableAccounts } from "../lib/accounts";
import { businessDate } from "../lib/business-date";
import { badRequest } from "../lib/conflict";
import type { Scope } from "../lib/procedures/factory";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { documentListFields, invoiceFields, orderedPeriod, reason } from "../lib/schemas";
import {
  PICKER_LIMIT,
  cancelDocument,
  documentListWhere,
  orgSettings,
  orgTimeZone,
  pageOf,
  printedPartyName,
} from "../lib/settlements";

type InvoiceFields = z.output<z.ZodObject<typeof invoiceFields>>;

type ResolvedInvoice = Omit<PostDocumentInput, "draft">;

// Paise are stored as signed 64-bit integers, so a quantity times a price that no
// column can hold is refused here instead of failing the insert.
const MAX_PAISE = 9_223_372_036_854_775_807n;

function boundedPaise(amountPaise: bigint): bigint {
  if (amountPaise > MAX_PAISE) {
    throw badRequest("INVOICE_AMOUNT_TOO_LARGE", "An invoice amount is too large to record.");
  }

  return amountPaise;
}

async function resolveInvoice(
  executor: typeof db | DbTransaction,
  scope: Scope,
  input: InvoiceFields,
  settings: typeof organizationSettings.$inferSelect,
): Promise<{ numbering: DocumentNumbering; invoice: ResolvedInvoice }> {
  const itemIds = [
    ...new Set(input.lines.flatMap((line) => (line.kind === "item" ? [line.itemId] : []))),
  ];

  const accountIds = [
    ...new Set(input.lines.flatMap((line) => (line.kind === "account" ? [line.accountId] : []))),
  ];

  // A posting resolves through one transaction connection; do not queue concurrent queries.
  const [party] = await executor
    .select()
    .from(parties)
    .where(
      and(eq(parties.orgId, scope.orgId), eq(parties.id, input.partyId), eq(parties.active, true)),
    )
    .limit(1);

  const storedItems =
    itemIds.length === 0
      ? []
      : await executor
          .select({ item: items, account: accounts })
          .from(items)
          .innerJoin(
            accounts,
            and(
              eq(accounts.orgId, scope.orgId),
              eq(accounts.id, items.incomeAccountId),
              eq(accounts.active, true),
              eq(accounts.type, "income"),
            ),
          )
          .where(
            and(eq(items.orgId, scope.orgId), eq(items.active, true), inArray(items.id, itemIds)),
          );

  const accountQuery = postableAccounts(executor, scope.orgId, accountIds, ["income"]);

  const storedAccounts =
    accountIds.length === 0
      ? []
      : await (executor === db ? accountQuery : accountQuery.for("share", { of: accounts }));

  const documentDate = input.documentDate ?? businessDate(new Date(), settings.timeZone);

  if (input.dueDate && input.dueDate < documentDate) {
    throw badRequest("DUE_DATE_BEFORE_DOCUMENT", "Due date cannot be before the invoice date.");
  }

  if (!party) {
    throw badRequest("PARTY_INVALID", "Choose an active party in this organization.");
  }

  if (storedItems.length !== itemIds.length) {
    throw badRequest("ITEM_INVALID", "Choose active items in this organization.");
  }

  if (storedAccounts.length !== accountIds.length) {
    throw badRequest(
      "INCOME_ACCOUNT_INVALID",
      "Choose active income accounts that are not groups or system accounts.",
    );
  }

  const itemById = new Map(storedItems.map(({ item, account }) => [item.id, { item, account }]));
  const accountById = new Map(storedAccounts.map((account) => [account.id, account]));

  const registered = settings.gstin !== null;

  // Only a registered org's taxable supplies need a rate, so an unregistered org never
  // reads tax_rates and never sees TAX_RATE_MISSING.
  const taxCodes = registered
    ? [
        ...new Set(
          storedItems.flatMap(({ item, account }) =>
            item.taxCode && account.supplyClass === "taxable" ? [item.taxCode] : [],
          ),
        ),
      ]
    : [];

  const effectiveRates =
    taxCodes.length === 0
      ? []
      : await executor
          .select({
            id: taxRates.id,
            code: taxRates.code,
            rateBasisPoints: taxRates.rateBasisPoints,
          })
          .from(taxRates)
          .where(
            and(
              eq(taxRates.orgId, scope.orgId),
              inArray(taxRates.code, taxCodes),
              taxRateEffectiveOn(documentDate),
            ),
          );

  const rateByCode = new Map(effectiveRates.map((rate) => [rate.code, rate]));

  if (taxCodes.some((code) => !rateByCode.has(code))) {
    throw badRequest("TAX_RATE_MISSING", "An item has no GST rate effective on the invoice date.");
  }

  const unresolvedLines = input.lines.map((line) => {
    if (line.kind === "account") {
      const account = accountById.get(line.accountId)!;

      // An account line carries no rate, so a registered org must invoice taxable
      // supplies as Items; the same rule as TAXABLE_DIRECT_RECEIPT (call 16).
      if (registered && account.supplyClass === "taxable") {
        throw badRequest(
          "TAXABLE_ACCOUNT_LINE",
          "Taxable income needs an Item with a GST rate; account lines cannot carry GST.",
        );
      }

      return {
        account,
        line: {
          kind: "account" as const,
          accountId: account.id,
          description: line.description,
          amountPaise: line.amount,
          entrySide: null,
          partyId: null,
          itemId: null,
          hsnSac: null,
          unit: null,
          quantity: null,
          unitPricePaise: null,
          taxRateId: null,
        },
        rateBasisPoints: null,
      };
    }

    const stored = itemById.get(line.itemId)!;
    const unitPricePaise = line.unitPrice ?? stored.item.unitPricePaise;
    const amountPaise = boundedPaise(BigInt(line.quantity) * unitPricePaise);
    const rate = stored.item.taxCode ? rateByCode.get(stored.item.taxCode)! : undefined;
    const rateApplies = registered && stored.account.supplyClass === "taxable";

    return {
      account: stored.account,
      line: {
        kind: "item" as const,
        accountId: stored.account.id,
        description: line.description || stored.item.name,
        amountPaise,
        entrySide: null,
        partyId: null,
        itemId: stored.item.id,
        hsnSac: stored.item.hsnSac,
        unit: stored.item.unit,
        quantity: line.quantity,
        unitPricePaise,
        taxRateId: rateApplies ? rate!.id : null,
      },
      rateBasisPoints: rateApplies ? rate!.rateBasisPoints : null,
    };
  });

  const tax = computeTax({
    intraState: settings.stateCode === input.placeOfSupplyStateCode,
    lines: unresolvedLines.map(({ line, rateBasisPoints }) => ({
      taxablePaise: line.amountPaise,
      rateBasisPoints,
    })),
  });

  const lines: PostDocumentLine[] = unresolvedLines.map(({ line }, index) => ({
    ...line,
    ...tax.lines[index]!,
  }));

  const taxablePaise = lines.reduce((sum, line) => sum + line.amountPaise, 0n);
  const grossPaise = taxablePaise + tax.cgstPaise + tax.sgstPaise + tax.igstPaise;
  const roundOffPaise = roundOff(grossPaise);
  const totalPaise = boundedPaise(grossPaise + roundOffPaise);

  if (totalPaise <= 0n) {
    throw badRequest("INVOICE_ZERO_TOTAL", "An invoice total must be greater than zero.");
  }

  const posting: InvoicePosting = {
    type: "invoice",
    exposureSide: "receivable",
    partyId: party.id,
    amountPaise: totalPaise,
    // A free line (zero price) stays on the document but has no journal leg.
    lines: lines.flatMap((line) =>
      line.amountPaise > 0n ? [{ accountId: line.accountId!, amountPaise: line.amountPaise }] : [],
    ),
    cgstPaise: tax.cgstPaise,
    sgstPaise: tax.sgstPaise,
    igstPaise: tax.igstPaise,
    roundOffPaise,
  };

  return {
    numbering: {
      prefix: settings.invoicePrefix,
      fiscalYearStartMonth: settings.financialYearStart,
    },
    invoice: {
      documentDate,
      dueDate: input.dueDate ?? null,
      placeOfSupplyStateCode: input.placeOfSupplyStateCode,
      reference: input.reference ?? null,
      narration: input.narration ?? null,
      affectsTax:
        registered && unresolvedLines.some(({ account }) => account.supplyClass !== "notASupply"),
      printSnapshot: {
        organization: organizationSnapshot(settings),
        party: partySnapshot(party),
        lines: lines.map(({ description }) => ({ description })),
      },
      lines,
      posting,
    },
  };
}

// The draft's id and the version its editor loaded; without one the call writes a new
// document.
const draftToken = z.object({ id: z.uuid(), version: z.number().int().min(1) });

const invoiceInput = orgInput
  .extend(invoiceFields)
  .extend({ draft: draftToken.optional() })
  .strict();

export const invoiceRouter = {
  saveDraft: orgProcedure({ invoice: ["create"] }, invoiceInput).handler(
    async ({ context, input }) => {
      const settings = await orgSettings(context.scope.orgId);
      const { numbering, invoice } = await resolveInvoice(db, context.scope, input, settings);

      const written = await db.transaction((tx) =>
        writeDraft(tx, context.scope, numbering, { ...invoice, draft: input.draft ?? null }),
      );

      return written.draft;
    },
  ),

  post: orgProcedure({ invoice: ["post"] }, invoiceInput).handler(async ({ context, input }) => {
    const { posted, amountPaise } = await db.transaction(async (tx) => {
      const settings = await orgSettings(context.scope.orgId, tx);
      const { invoice } = await resolveInvoice(tx, context.scope, input, settings);

      const posted = await postDocument(tx, context.scope, settings, settings.invoicePrefix, {
        ...invoice,
        draft: input.draft ?? null,
      });

      return { posted, amountPaise: invoice.posting.amountPaise };
    });

    audit({
      action: "invoice.post",
      actorId: context.scope.userId,
      orgId: context.scope.orgId,
      target: posted.id,
      meta: { number: posted.number, amount: formatDecimal(amountPaise) },
    });

    return posted;
  }),

  get: orgProcedure({ invoice: ["read"] }, orgInput.extend({ invoiceId: z.uuid() })).handler(
    async ({ context, input }) => {
      const { orgId } = context.scope;

      const { sums, remainingPaise: outstandingPaise } = activeAllocationSums(orgId, "target", [
        input.invoiceId,
      ]);

      // The version token and the data it protects return from one consistent read:
      // an editor must never receive version 2's token beside version 1's lines.
      const [snapshot, timeZone] = await Promise.all([
        db.transaction(
          async (tx) => {
            const [invoice] = await tx
              .select({
                id: documents.id,
                version: documents.version,
                number: documents.number,
                state: documents.state,
                partyId: documents.partyId,
                partyName: printedPartyName,
                documentDate: documents.documentDate,
                dueDate: documents.dueDate,
                placeOfSupplyStateCode: documents.placeOfSupplyStateCode,
                reference: documents.reference,
                narration: documents.narration,
                cancelledAt: documents.cancelledAt,
                totalPaise: documents.totalPaise,
                roundOffPaise: documents.roundOffPaise,
                outstandingPaise,
              })
              .from(documents)
              .leftJoin(sums, eq(sums.documentId, documents.id))
              .where(
                and(
                  eq(documents.orgId, orgId),
                  eq(documents.id, input.invoiceId),
                  eq(documents.type, "invoice"),
                ),
              )
              .limit(1);

            if (!invoice) return null;

            const lines = await tx
              .select({
                id: documentLines.id,
                kind: documentLines.kind,
                accountId: documentLines.accountId,
                itemId: documentLines.itemId,
                description: documentLines.description,
                hsnSac: documentLines.hsnSac,
                unit: documentLines.unit,
                quantity: documentLines.quantity,
                unitPricePaise: documentLines.unitPricePaise,
                taxRateId: documentLines.taxRateId,
                cgstPaise: documentLines.cgstPaise,
                sgstPaise: documentLines.sgstPaise,
                igstPaise: documentLines.igstPaise,
                amountPaise: documentLines.amountPaise,
              })
              .from(documentLines)
              .where(
                and(eq(documentLines.orgId, orgId), eq(documentLines.documentId, input.invoiceId)),
              )
              .orderBy(asc(documentLines.position));

            const allocationRows = await tx
              .select({
                id: allocations.id,
                sourceDocumentId: allocations.sourceDocumentId,
                sourceNumber: documents.number,
                amountPaise: allocations.amountPaise,
                entryDate: allocations.entryDate,
                reversed: allocationReversed(orgId),
              })
              .from(allocations)
              .innerJoin(
                documents,
                and(eq(documents.orgId, orgId), eq(documents.id, allocations.sourceDocumentId)),
              )
              .where(
                and(
                  eq(allocations.orgId, orgId),
                  eq(allocations.targetDocumentId, input.invoiceId),
                  eq(allocations.kind, "apply"),
                ),
              )
              .orderBy(asc(allocations.entryDate), asc(allocations.id));

            return { invoice, lines, allocationRows };
          },
          { isolationLevel: "repeatable read", accessMode: "read only" },
        ),
        orgTimeZone(orgId),
      ]);

      if (!snapshot) throw new ORPCError("NOT_FOUND", { message: "Invoice not found." });

      const { invoice, lines, allocationRows } = snapshot;

      return {
        ...invoice,
        ...invoiceSettlement(invoice, businessDate(new Date(), timeZone)),
        printClass: lines.some((line) => line.taxRateId !== null)
          ? ("taxInvoice" as const)
          : ("billOfSupply" as const),
        lines: lines.map(({ taxRateId: _taxRateId, ...line }) => line),
        allocations: allocationRows.map((row) => ({
          ...row,
          sourceNumber: postedNumber(row.sourceNumber, row.sourceDocumentId),
        })),
      };
    },
  ),

  list: orgProcedure(
    { invoice: ["read"] },
    orgInput
      .extend({
        ...documentListFields,
        state: z.enum(DOCUMENT_STATES).optional(),
        settlement: z.enum(["open", "overdue"]).optional(),
      })
      .superRefine(orderedPeriod),
  ).handler(async ({ context, input }) => {
    const { orgId } = context.scope;
    // `overdue` compares due dates with today, so the time zone is read first.
    const today = businessDate(new Date(), await orgTimeZone(orgId));
    const outstandingPaise = remainingPaiseOf(orgId, "target");

    const page = await db
      .select({
        id: documents.id,
        number: documents.number,
        documentDate: documents.documentDate,
        dueDate: documents.dueDate,
        state: documents.state,
        totalPaise: documents.totalPaise,
        reference: documents.reference,
        partyName: printedPartyName,
        outstandingPaise,
      })
      .from(documents)
      .where(
        and(
          documentListWhere(orgId, "invoice", input),
          input.state ? eq(documents.state, input.state) : undefined,
          input.settlement
            ? and(
                eq(documents.state, "posted"),
                sql`${outstandingPaise} > 0`,
                input.settlement === "overdue" ? lt(documents.dueDate, today) : undefined,
              )
            : undefined,
        ),
      )
      .orderBy(desc(documents.id))
      .limit(input.limit + 1);

    const { rows, hasMore } = pageOf(page, input.limit);

    return { rows: rows.map((row) => ({ ...row, ...invoiceSettlement(row, today) })), hasMore };
  }),

  openInvoices: orgProcedure({ invoice: ["read"] }, orgInput.extend({ partyId: z.uuid() })).handler(
    async ({ context, input }) => {
      const { orgId } = context.scope;
      const outstandingPaise = remainingPaiseOf(orgId, "target");

      const rows = await db
        .select({
          id: documents.id,
          number: documents.number,
          documentDate: documents.documentDate,
          dueDate: documents.dueDate,
          outstandingPaise,
        })
        .from(documents)
        .where(
          and(
            eq(documents.orgId, orgId),
            eq(documents.type, "invoice"),
            eq(documents.state, "posted"),
            eq(documents.partyId, input.partyId),
            sql`${outstandingPaise} > 0`,
          ),
        )
        .orderBy(asc(documents.documentDate), asc(documents.id))
        .limit(PICKER_LIMIT + 1);

      return pageOf(
        rows.map((row) => ({ ...row, number: postedNumber(row.number, row.id) })),
        PICKER_LIMIT,
      );
    },
  ),

  cancel: orgProcedure(
    { invoice: ["cancel"] },
    orgInput.extend({ invoiceId: z.uuid(), reason }),
  ).handler(({ context, input }) =>
    cancelDocument(context.scope, "invoice", input.invoiceId, input.reason),
  ),

  discardDraft: orgProcedure(
    { invoice: ["create"] },
    orgInput.extend({ draft: draftToken }),
  ).handler(async ({ context, input }) => {
    const [discarded] = await db
      .delete(documents)
      .where(
        and(
          eq(documents.orgId, context.scope.orgId),
          eq(documents.id, input.draft.id),
          eq(documents.type, "invoice"),
          eq(documents.state, "draft"),
          eq(documents.version, input.draft.version),
        ),
      )
      .returning({ id: documents.id });

    if (!discarded) {
      throw new ORPCError("CONFLICT", {
        message: "This draft changed. Reload it and try again.",
      });
    }

    return discarded;
  }),
};
