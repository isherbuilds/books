import { authorize } from "@accly/auth/access";
import { db, type DbTransaction } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { documentLines } from "@accly/db/schema/document-lines";
import { documents } from "@accly/db/schema/documents";
import { items } from "@accly/db/schema/items";
import type { organizationSettings } from "@accly/db/schema/organization-settings";
import { taxRates } from "@accly/db/schema/tax-rates";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { settlementPaise } from "../core/allocations";
import {
  organizationSnapshot,
  partySnapshot,
  postDocument,
  postedNumber,
  taxTotals,
  writeDraft,
  type DocumentNumbering,
  type PostDocumentInput,
  type PostDocumentLine,
} from "../core/documents";
import { splitDiscount } from "../core/discount";
import { formatDecimal } from "../core/money";
import type { InvoicePosting } from "../core/posting";
import { computeTax, roundOff } from "../core/tax";
import { ratesByCode } from "../core/tax-schedule";
import { businessDate } from "../lib/business-date";
import { badRequest } from "../lib/conflict";
import { activeParty } from "../lib/parties";
import { orgInput, orgProcedure, requirePermission, type Scope } from "../lib/procedures/factory";
import { draftToken, invoiceFields, orderedPeriod, reason } from "../lib/schemas";
import {
  allocationsOf,
  amendClaim,
  cancelDocument,
  claimListFields,
  listClaims,
  discardDraft,
  documentSettlement,
  orgSettings,
  orgTimeZone,
  printedPartyName,
} from "../lib/settlements";
import { auditReceiptPost, postReceipt } from "./receipt";

type InvoiceFields = z.output<z.ZodObject<typeof invoiceFields>>;

type ResolvedInvoice = Omit<PostDocumentInput, "draft" | "posting"> & { posting: InvoicePosting };

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
  const itemIds = [...new Set(input.lines.map((line) => line.itemId))];

  // A posting resolves through one transaction connection; do not queue concurrent queries.
  const party = await activeParty(executor, scope.orgId, input.partyId);

  const itemQuery = executor
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
    .where(and(eq(items.orgId, scope.orgId), eq(items.active, true), inArray(items.id, itemIds)));

  // A posting share-locks every income account it credits, so none is archived under it.
  const storedItems = await (executor === db
    ? itemQuery
    : itemQuery.for("share", { of: accounts }));

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

  const itemById = new Map(storedItems.map(({ item, account }) => [item.id, { item, account }]));

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

  const rateByCode = await ratesByCode(executor, scope.orgId, taxCodes, documentDate);

  if (taxCodes.some((code) => !rateByCode.has(code))) {
    throw badRequest("TAX_RATE_MISSING", "An item has no GST rate effective on the invoice date.");
  }

  // Every line is an Item (accounting-core call 5): the Item carries the income account
  // and the dated rate, and the line may override its description and price.
  const unresolvedLines = input.lines.map((line) => {
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

  const discountPaise = input.discount ?? 0n;
  const subtotalPaise = unresolvedLines.reduce((sum, { line }) => sum + line.amountPaise, 0n);

  if (discountPaise > subtotalPaise) {
    throw badRequest("DISCOUNT_EXCEEDS_SUBTOTAL", "Discount cannot exceed the invoice subtotal.");
  }

  const discounts = splitDiscount(
    unresolvedLines.map(({ line }) => line.amountPaise),
    discountPaise,
  );

  const taxableValues = unresolvedLines.map(
    ({ line }, index) => line.amountPaise - discounts[index]!,
  );

  const intraState = settings.stateCode === input.placeOfSupplyStateCode;

  const tax = computeTax({
    intraState,
    lines: unresolvedLines.map(({ rateBasisPoints }, index) => ({
      taxablePaise: taxableValues[index]!,
      rateBasisPoints,
    })),
  });

  const lines: PostDocumentLine[] = unresolvedLines.map(({ line }, index) => ({
    ...line,
    amountPaise: taxableValues[index]!,
    discountPaise: discounts[index]!,
    itcEligible: null,
    sourceLineId: null,
    adjustmentKind: null,
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
      intraState,
      reference: input.reference ?? null,
      narration: input.narration ?? null,
      discountPaise,
      againstDocumentId: null,
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

const invoiceInput = orgInput
  .extend(invoiceFields)
  .extend({ draft: draftToken.optional() })
  .strict();

const postInput = invoiceInput.extend({
  settle: z
    .strictObject({
      paymentMethodId: z.uuid(),
      reference: z.string().trim().max(120).optional(),
    })
    .optional(),
});

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

  post: orgProcedure({ invoice: ["post"] }, postInput).handler(async ({ context, input }) => {
    const { scope } = context;

    // A counter sale also posts a Receipt, so it needs that permission too.
    if (input.settle) requirePermission(scope, { receipt: ["post"] });

    const { posted, amountPaise, receipt, receiptInput } = await db.transaction(async (tx) => {
      const settings = await orgSettings(scope.orgId, tx);
      const { invoice } = await resolveInvoice(tx, scope, input, settings);

      const posted = await postDocument(tx, scope, settings, settings.invoicePrefix, {
        ...invoice,
        draft: input.draft ?? null,
      });

      const receiptInput = input.settle
        ? {
            orgSlug: input.orgSlug,
            settlementKind: "against" as const,
            documentDate: invoice.documentDate,
            partyId: invoice.posting.partyId,
            paymentMethodId: input.settle.paymentMethodId,
            reference: input.settle.reference,
            amount: invoice.posting.amountPaise,
            allocations: [{ invoiceId: posted.id, amount: invoice.posting.amountPaise }],
          }
        : null;

      const receipt = receiptInput ? await postReceipt(tx, scope, settings, receiptInput) : null;

      return { posted, amountPaise: invoice.posting.amountPaise, receipt, receiptInput };
    });

    audit({
      action: "invoice.post",
      actorId: context.scope.userId,
      orgId: context.scope.orgId,
      target: `invoice:${posted.id}`,
      meta: { number: posted.number, amount: formatDecimal(amountPaise) },
    });

    if (receipt && receiptInput) {
      auditReceiptPost(
        scope,
        receipt.posted,
        receiptInput,
        receipt.allocatedPaise,
        receipt.advanceSupply,
      );
    }

    return { ...posted, receipt: receipt?.posted ?? null };
  }),

  get: orgProcedure({ invoice: ["read"] }, orgInput.extend({ invoiceId: z.uuid() })).handler(
    async ({ context, input }) => {
      const { orgId } = context.scope;
      const canReadNotes = authorize(context.scope.roles, { note: ["read"] });
      const { capacityPaise, balancePaise } = settlementPaise(orgId, "target");

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
                amendedFromId: documents.amendedFromId,
                capacityPaise,
                discountPaise: documents.discountPaise,
                printSnapshot: documents.printSnapshot,
                roundOffPaise: documents.roundOffPaise,
                outstandingPaise: balancePaise,
              })
              .from(documents)
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
                discountPaise: documentLines.discountPaise,
                taxRateId: documentLines.taxRateId,
                rateBasisPoints: taxRates.rateBasisPoints,
                cgstPaise: documentLines.cgstPaise,
                sgstPaise: documentLines.sgstPaise,
                igstPaise: documentLines.igstPaise,
                amountPaise: documentLines.amountPaise,
              })
              .from(documentLines)
              .leftJoin(
                taxRates,
                and(eq(taxRates.orgId, orgId), eq(taxRates.id, documentLines.taxRateId)),
              )
              .where(
                and(eq(documentLines.orgId, orgId), eq(documentLines.documentId, input.invoiceId)),
              )
              .orderBy(asc(documentLines.position));

            const allocations = await allocationsOf(
              tx,
              orgId,
              input.invoiceId,
              "target",
              canReadNotes ? undefined : ["receipt"],
            );

            const notes = canReadNotes
              ? await tx
                  .select({
                    id: documents.id,
                    type: documents.type,
                    number: documents.number,
                    totalPaise: documents.totalPaise,
                  })
                  .from(documents)
                  .where(
                    and(
                      eq(documents.orgId, orgId),
                      eq(documents.againstDocumentId, input.invoiceId),
                      eq(documents.type, "creditNote"),
                      eq(documents.state, "posted"),
                    ),
                  )
              : [];

            return { invoice, lines, allocations, notes };
          },
          { isolationLevel: "repeatable read", accessMode: "read only" },
        ),
        orgTimeZone(orgId),
      ]);

      if (!snapshot) throw new ORPCError("NOT_FOUND", { message: "Invoice not found." });

      const { invoice, lines, allocations, notes } = snapshot;

      return {
        ...invoice,
        ...documentSettlement(invoice, businessDate(new Date(), timeZone)),
        notes: notes.map((note) => ({ ...note, number: postedNumber(note.number, note.id) })),
        printClass: lines.some((line) => line.taxRateId !== null)
          ? ("taxInvoice" as const)
          : ("billOfSupply" as const),
        lines: lines.map(({ taxRateId: _taxRateId, ...line }) => line),
        totals: taxTotals(lines),
        allocations,
      };
    },
  ),

  list: orgProcedure(
    { invoice: ["read"] },
    orgInput.extend(claimListFields).superRefine(orderedPeriod),
  ).handler(({ context, input }) => listClaims(context.scope.orgId, "invoice", input)),

  amend: orgProcedure(
    { invoice: ["cancel", "create"] },
    orgInput.extend({ invoiceId: z.uuid(), reason }),
  ).handler(({ context, input }) =>
    amendClaim(context.scope, "invoice", input.invoiceId, input.reason),
  ),

  cancel: orgProcedure(
    { invoice: ["cancel"] },
    orgInput.extend({ invoiceId: z.uuid(), reason }),
  ).handler(({ context, input }) =>
    cancelDocument(context.scope, ["invoice"], input.invoiceId, input.reason),
  ),

  discardDraft: orgProcedure(
    { invoice: ["create"] },
    orgInput.extend({ draft: draftToken }),
  ).handler(({ context, input }) => discardDraft(context.scope.orgId, "invoice", input.draft)),
};
