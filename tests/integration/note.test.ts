import { beforeAll, expect, test } from "bun:test";

import type { AppRouterClient } from "@accly/api/routers/index";
import { formatDecimal } from "@accly/api/core/money";
import { accounts } from "@accly/db/schema/accounts";

import { createAccountingFixture, postingOf } from "../support/accounting";
import { required } from "../support/assert";
import { createFounderSession } from "../support/auth";
import { expectORPCCode, expectReason } from "../support/client";
import { resetTestDatabase } from "../support/database";
import { readZipText } from "../support/xlsx";

let organization: { id: string; slug: string };

let api: AppRouterClient;

let customer: { id: string };

let supplier: { id: string };

let taxableItem: { id: string };

let income: typeof accounts.$inferSelect;

let expense: typeof accounts.$inferSelect;

let receivables: typeof accounts.$inferSelect;

let payables: typeof accounts.$inferSelect;

let tdsPayable: typeof accounts.$inferSelect;

let cgstOutput: typeof accounts.$inferSelect;

let sgstOutput: typeof accounts.$inferSelect;

beforeAll(async () => {
  await resetTestDatabase();
  const founder = await createFounderSession();

  const fixture = await createAccountingFixture(founder, "note", {
    gstin: "27ABCDE1234F1Z0",
    stateCode: "27",
    pan: "ABCDE1234F",
  });

  organization = fixture.organization;
  api = fixture.api;
  income = required(
    fixture.accounts.find((row) => row.type === "income" && row.supplyClass === "taxable"),
    "income account",
  );
  expense = required(
    fixture.accounts.find((row) => row.type === "expense" && row.systemKey === null),
    "expense account",
  );
  receivables = required(
    fixture.accounts.find((row) => row.systemKey === "receivables"),
    "receivables",
  );
  payables = required(
    fixture.accounts.find((row) => row.systemKey === "payables"),
    "payables",
  );
  tdsPayable = required(
    fixture.accounts.find((row) => row.systemKey === "tdsPayable"),
    "TDS payable",
  );
  cgstOutput = required(
    fixture.accounts.find((row) => row.systemKey === "cgstOutput"),
    "output CGST",
  );
  sgstOutput = required(
    fixture.accounts.find((row) => row.systemKey === "sgstOutput"),
    "output SGST",
  );
  customer = await api.party.create({
    orgSlug: organization.slug,
    name: "Note Customer",
    roles: ["customer"],
    stateCode: "27",
    gstin: "27ABCDE1234F1Z0",
  });
  supplier = await api.party.create({
    orgSlug: organization.slug,
    name: "Note Supplier",
    roles: ["vendor"],
    stateCode: "27",
    pan: "ABCDE1234F",
  });
  taxableItem = await api.item.create({
    orgSlug: organization.slug,
    name: "Taxable note service",
    incomeAccountId: income.id,
    unit: "service",
    unitPrice: "10000.00",
    taxCode: "GST18",
    hsnSac: "9983",
  });
});

async function invoiceForNote() {
  const invoice = await api.invoice.post({
    orgSlug: organization.slug,
    partyId: customer.id,
    placeOfSupplyStateCode: "27",
    documentDate: "2026-09-12",
    lines: [{ kind: "item", itemId: taxableItem.id, quantity: 1 }],
  });

  const detail = await api.invoice.get({ orgSlug: organization.slug, invoiceId: invoice.id });

  return { invoice, sourceLineId: required(detail.lines[0], "invoice line").id };
}

test("credit notes reverse income and GST, settle the invoice, and cap cumulative tax at its source", async () => {
  const { invoice, sourceLineId } = await invoiceForNote();

  const first = await api.note.post({
    orgSlug: organization.slug,
    type: "creditNote",
    againstDocumentId: invoice.id,
    documentDate: "2026-09-13",
    narration: "Half the services returned",
    lines: [{ sourceLineId, amount: "4000.00" }],
  });

  const detail = await api.note.get({ orgSlug: organization.slug, noteId: first.id });
  expect(detail).toMatchObject({
    state: "posted",
    totalPaise: 472_000n,
    against: {
      id: invoice.id,
      type: "invoice",
      number: invoice.number,
      documentDate: "2026-09-12",
    },
    totals: { taxablePaise: 400_000n, cgstPaise: 36_000n, sgstPaise: 36_000n, igstPaise: 0n },
    unappliedPaise: 0n,
  });
  expect(detail.lines[0]).toMatchObject({
    sourceLineId,
    amountPaise: 400_000n,
    cgstPaise: 36_000n,
    sgstPaise: 36_000n,
    rateBasisPoints: 1800,
  });
  expect(detail.allocations).toContainEqual(
    expect.objectContaining({
      otherDocumentId: invoice.id,
      amountPaise: 472_000n,
      reversed: false,
    }),
  );
  const posting = await postingOf(organization.id, first.id, "post");
  expect(posting.lines).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ accountId: income.id, debit: 400_000n, credit: 0n }),
      expect.objectContaining({ accountId: cgstOutput.id, debit: 36_000n, credit: 0n }),
      expect.objectContaining({ accountId: sgstOutput.id, debit: 36_000n, credit: 0n }),
      expect.objectContaining({ accountId: receivables.id, debit: 0n, credit: 472_000n }),
    ]),
  );
  expect(
    (await api.invoice.get({ orgSlug: organization.slug, invoiceId: invoice.id })).outstandingPaise,
  ).toBe(708_000n);

  const partlyReturned = await api.invoice.get({
    orgSlug: organization.slug,
    invoiceId: invoice.id,
  });

  expect(partlyReturned.lines[0]).toMatchObject({
    remainingPaise: 600_000n,
    priorNote: { amountPaise: 400_000n, cgstPaise: 36_000n, sgstPaise: 36_000n },
  });

  const final = await api.note.post({
    orgSlug: organization.slug,
    type: "creditNote",
    againstDocumentId: invoice.id,
    documentDate: "2026-09-14",
    narration: "Remaining services returned",
    lines: [{ sourceLineId, amount: formatDecimal(partlyReturned.lines[0]!.remainingPaise) }],
  });

  const finalDetail = await api.note.get({ orgSlug: organization.slug, noteId: final.id });
  expect(finalDetail.lines[0]).toMatchObject({
    amountPaise: 600_000n,
    cgstPaise: 54_000n,
    sgstPaise: 54_000n,
  });
  expect(finalDetail.totalPaise).toBe(708_000n);
  expect(
    (await api.invoice.get({ orgSlug: organization.slug, invoiceId: invoice.id })).outstandingPaise,
  ).toBe(0n);
  expect(
    (await api.invoice.get({ orgSlug: organization.slug, invoiceId: invoice.id })).lines[0]
      ?.remainingPaise,
  ).toBe(0n);
  await expectReason(
    api.note.post({
      orgSlug: organization.slug,
      type: "creditNote",
      againstDocumentId: invoice.id,
      documentDate: "2026-09-15",
      narration: "Exceeds credited line",
      lines: [{ sourceLineId, amount: "1.00" }],
    }),
    "NOTE_EXCEEDS_SOURCE",
  );
});

test("an invoice cannot cancel while its credit note remains posted after allocation reversal", async () => {
  const { invoice, sourceLineId } = await invoiceForNote();

  const note = await api.note.post({
    orgSlug: organization.slug,
    type: "creditNote",
    againstDocumentId: invoice.id,
    documentDate: "2026-09-13",
    narration: "Returned service",
    lines: [{ sourceLineId, amount: "4000.00" }],
  });

  const detail = await api.note.get({ orgSlug: organization.slug, noteId: note.id });

  await api.allocation.reverse({
    orgSlug: organization.slug,
    allocationId: required(detail.allocations[0], "credit note allocation").id,
    reason: "Reopen invoice balance",
  });

  const conflict = await expectORPCCode(
    api.invoice.cancel({
      orgSlug: organization.slug,
      invoiceId: invoice.id,
      reason: "Cancel source invoice",
    }),
    "CONFLICT",
  );

  expect(conflict.message).toContain(note.number);
  expect((await api.invoice.get({ orgSlug: organization.slug, invoiceId: invoice.id })).state).toBe(
    "posted",
  );

  await api.note.cancel({
    orgSlug: organization.slug,
    noteId: note.id,
    reason: "Cancel credit note first",
  });

  expect(
    (await api.invoice.get({ orgSlug: organization.slug, invoiceId: invoice.id })).lines[0],
  ).toMatchObject({ remainingPaise: 1_000_000n, priorNote: null });

  const cancelled = await api.invoice.cancel({
    orgSlug: organization.slug,
    invoiceId: invoice.id,
    reason: "Cancel source invoice",
  });

  expect(cancelled.state).toBe("cancelled");
});

test("debit note against a bill reduces its payable outstanding", async () => {
  const bill = await api.bill.post({
    orgSlug: organization.slug,
    partyId: supplier.id,
    reference: "BILL-NOTE-1",
    documentDate: "2026-09-12",
    lines: [
      {
        accountId: expense.id,
        description: "Eligible expense",
        amount: "1000.00",
        taxCode: "GST18",
        itcEligible: true,
      },
    ],
  });

  const billDetail = await api.bill.get({ orgSlug: organization.slug, billId: bill.id });
  const sourceLineId = required(billDetail.lines[0], "bill line").id;

  const note = await api.note.post({
    orgSlug: organization.slug,
    type: "debitNote",
    againstDocumentId: bill.id,
    documentDate: "2026-09-13",
    reference: "SUP-CN-72",
    narration: "Supplier returned half",
    lines: [{ sourceLineId, amount: "500.00" }],
  });

  const detail = await api.note.get({ orgSlug: organization.slug, noteId: note.id });
  expect(detail).toMatchObject({
    totalPaise: 59_000n,
    reference: "SUP-CN-72",
    unappliedPaise: 0n,
    against: {
      number: bill.number,
      documentDate: "2026-09-12",
      reference: "BILL-NOTE-1",
    },
    totals: { taxablePaise: 50_000n, cgstPaise: 4500n, sgstPaise: 4500n, igstPaise: 0n },
  });
  expect(detail.lines[0]).toMatchObject({ rateBasisPoints: 1800 });
  const partlyReturned = await api.bill.get({ orgSlug: organization.slug, billId: bill.id });
  expect(partlyReturned.lines[0]).toMatchObject({
    remainingPaise: 50_000n,
    priorNote: { amountPaise: 50_000n, cgstPaise: 4500n, sgstPaise: 4500n },
  });
  const listed = await api.note.list({ orgSlug: organization.slug, type: "debitNote" });
  expect(listed.rows).toContainEqual(
    expect.objectContaining({ id: note.id, againstNumber: bill.number, unappliedPaise: 0n }),
  );
  expect(
    (await api.bill.get({ orgSlug: organization.slug, billId: bill.id })).outstandingPaise,
  ).toBe(59_000n);
  const posting = await postingOf(organization.id, note.id, "post");
  expect(posting.lines).toContainEqual(
    expect.objectContaining({ accountId: payables.id, debit: 59_000n, credit: 0n }),
  );

  const final = await api.note.post({
    orgSlug: organization.slug,
    type: "debitNote",
    againstDocumentId: bill.id,
    documentDate: "2026-09-14",
    narration: "Remaining short supply",
    lines: [{ sourceLineId, amount: formatDecimal(partlyReturned.lines[0]!.remainingPaise) }],
  });

  expect((await api.note.get({ orgSlug: organization.slug, noteId: final.id })).totalPaise).toBe(
    59_000n,
  );
  expect(
    (await api.bill.get({ orgSlug: organization.slug, billId: bill.id })).lines[0]?.remainingPaise,
  ).toBe(0n);
});

test("debit notes reverse bill TDS and settle only the net supplier credit", async () => {
  const section = required(
    (await api.payment.tdsSections({ orgSlug: organization.slug, date: "2026-09-12" })).find(
      ({ code }) => code === "1009",
    ),
    "10% TDS section",
  );

  const bill = await api.bill.post({
    orgSlug: organization.slug,
    partyId: supplier.id,
    reference: "BILL-NOTE-TDS",
    documentDate: "2026-09-12",
    tdsSectionId: section.id,
    lines: [
      {
        accountId: expense.id,
        description: "Returned rent",
        amount: "10000.00",
        taxCode: "GST18",
        itcEligible: true,
      },
    ],
  });

  const sourceLineId = required(
    (await api.bill.get({ orgSlug: organization.slug, billId: bill.id })).lines[0],
    "TDS bill line",
  ).id;

  const postNote = (amount: string, date: string) =>
    api.note.post({
      orgSlug: organization.slug,
      type: "debitNote",
      againstDocumentId: bill.id,
      documentDate: date,
      narration: "Supplier return",
      lines: [{ sourceLineId, amount }],
    });

  const first = await postNote("4000.00", "2026-09-13");
  const detail = await api.note.get({ orgSlug: organization.slug, noteId: first.id });
  expect(detail.totalPaise).toBe(472_000n);
  expect(detail.tdsReversedPaise).toBe(40_000n);
  expect(detail.unappliedPaise).toBe(0n);
  expect(detail.allocations).toContainEqual(
    expect.objectContaining({ otherDocumentId: bill.id, amountPaise: 432_000n }),
  );
  const posted = await postingOf(organization.id, first.id, "post");
  expect(posted.lines).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ accountId: payables.id, debit: 432_000n, credit: 0n }),
      expect.objectContaining({ accountId: tdsPayable.id, debit: 40_000n, credit: 0n }),
      expect.objectContaining({ accountId: expense.id, debit: 0n, credit: 400_000n }),
    ]),
  );
  expect(posted.lines.reduce((sum, line) => sum + line.debit - line.credit, 0n)).toBe(0n);
  expect(posted.ledger).toContainEqual(
    expect.objectContaining({ side: "payable", amountPaise: 432_000n }),
  );
  expect(
    (await api.bill.get({ orgSlug: organization.slug, billId: bill.id })).outstandingPaise,
  ).toBe(648_000n);

  const second = await postNote("6000.00", "2026-09-14");
  expect(
    (await api.note.get({ orgSlug: organization.slug, noteId: second.id })).tdsReversedPaise,
  ).toBe(60_000n);
  expect(
    (await api.bill.get({ orgSlug: organization.slug, billId: bill.id })).outstandingPaise,
  ).toBe(0n);

  const register = await api.export.tdsRegisterXlsx({
    orgSlug: organization.slug,
    from: "2026-09-13",
    to: "2026-09-14",
  });

  const bytes = new Uint8Array(await register.arrayBuffer());
  expect(readZipText(bytes, "xl/sharedStrings.xml")).toContain(first.number);
  expect(readZipText(bytes, "xl/worksheets/sheet1.xml")).toMatch(/<v>-400<\/v>/);
  expect(readZipText(bytes, "xl/worksheets/sheet1.xml")).toMatch(/<v>-600<\/v>/);

  await api.note.cancel({
    orgSlug: organization.slug,
    noteId: second.id,
    reason: "Cancel supplier return",
  });
  const reversed = await postingOf(organization.id, second.id, "reverse");
  expect(reversed.lines).toContainEqual(
    expect.objectContaining({ accountId: payables.id, debit: 0n, credit: 648_000n }),
  );
  expect(
    (await api.bill.get({ orgSlug: organization.slug, billId: bill.id })).outstandingPaise,
  ).toBe(648_000n);
});

test("a debit note may reverse only TDS and post no supplier credit", async () => {
  const section = required(
    (await api.payment.tdsSections({ orgSlug: organization.slug, date: "2026-09-12" })).find(
      ({ code }) => code === "1009",
    ),
    "10% TDS section",
  );

  const bill = await api.bill.post({
    orgSlug: organization.slug,
    partyId: supplier.id,
    reference: "BILL-NOTE-TDS-ONLY",
    documentDate: "2026-09-12",
    tdsSectionId: section.id,
    lines: [
      { accountId: expense.id, description: "Small supply", amount: "10.00", itcEligible: false },
    ],
  });

  const sourceLineId = required(
    (await api.bill.get({ orgSlug: organization.slug, billId: bill.id })).lines[0],
    "small bill line",
  ).id;

  const postNote = (amount: string) =>
    api.note.post({
      orgSlug: organization.slug,
      type: "debitNote",
      againstDocumentId: bill.id,
      documentDate: "2026-09-13",
      narration: "Small return",
      lines: [{ sourceLineId, amount }],
    });

  // ₹10 at 10% deducts ₹1. ₹4 returned rounds to ₹0 reversed and ₹5 to ₹1, so the
  // ₹1 note that crosses the half rupee reverses only TDS.
  await postNote("4.00");
  const final = await postNote("1.00");

  const detail = await api.note.get({ orgSlug: organization.slug, noteId: final.id });
  expect(detail).toMatchObject({ totalPaise: 100n, tdsReversedPaise: 100n, unappliedPaise: 0n });
  const posted = await postingOf(organization.id, final.id, "post");
  expect(posted.lines).toHaveLength(2);
  expect(posted.lines).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ accountId: expense.id, debit: 0n, credit: 100n }),
      expect.objectContaining({ accountId: tdsPayable.id, debit: 100n, credit: 0n }),
    ]),
  );
  expect(posted.ledger).toEqual([]);
  expect(
    (await api.bill.get({ orgSlug: organization.slug, billId: bill.id })).outstandingPaise,
  ).toBe(500n);
});

test("GST outward workbook records an invoice and its negative registered credit note", async () => {
  const { invoice, sourceLineId } = await invoiceForNote();

  const note = await api.note.post({
    orgSlug: organization.slug,
    type: "creditNote",
    againstDocumentId: invoice.id,
    documentDate: "2026-09-13",
    narration: "GST credit",
    lines: [{ sourceLineId, amount: "2000.00" }],
  });

  const file = await api.export.gstOutwardXlsx({
    orgSlug: organization.slug,
    from: "2026-09-12",
    to: "2026-09-13",
  });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const strings = readZipText(bytes, "xl/sharedStrings.xml");
  const b2b = readZipText(bytes, "xl/worksheets/sheet1.xml");
  const cdnr = readZipText(bytes, "xl/worksheets/sheet4.xml");
  expect(strings).toContain(invoice.number);
  expect(strings).toContain(note.number);
  expect(b2b).toMatch(/<v>10000<\/v>/);
  expect(cdnr).toMatch(/<v>-2000<\/v>/);
  expect(cdnr).toMatch(/<v>-180<\/v>/);
});
