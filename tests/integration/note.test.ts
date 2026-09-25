import { beforeAll, expect, test } from "bun:test";

import type { AppRouterClient } from "@accly/api/routers/index";
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

let cgstOutput: typeof accounts.$inferSelect;

let sgstOutput: typeof accounts.$inferSelect;

beforeAll(async () => {
  await resetTestDatabase();
  const founder = await createFounderSession();

  const fixture = await createAccountingFixture(founder, "note", {
    gstin: "27ABCDE1234F1Z5",
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
    gstin: "27ABCDE1234F1Z5",
  });
  supplier = await api.party.create({
    orgSlug: organization.slug,
    name: "Note Supplier",
    roles: ["vendor"],
    stateCode: "27",
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
    against: { id: invoice.id, type: "invoice", number: invoice.number },
    unappliedPaise: 0n,
  });
  expect(detail.lines[0]).toMatchObject({
    sourceLineId,
    amountPaise: 400_000n,
    cgstPaise: 36_000n,
    sgstPaise: 36_000n,
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

  const final = await api.note.post({
    orgSlug: organization.slug,
    type: "creditNote",
    againstDocumentId: invoice.id,
    documentDate: "2026-09-14",
    narration: "Remaining services returned",
    lines: [{ sourceLineId, amount: "6000.00" }],
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
    narration: "Supplier returned half",
    lines: [{ sourceLineId, amount: "500.00" }],
  });

  const detail = await api.note.get({ orgSlug: organization.slug, noteId: note.id });
  expect(detail).toMatchObject({ totalPaise: 59_000n, unappliedPaise: 0n });
  expect(
    (await api.bill.get({ orgSlug: organization.slug, billId: bill.id })).outstandingPaise,
  ).toBe(59_000n);
  const posting = await postingOf(organization.id, note.id, "post");
  expect(posting.lines).toContainEqual(
    expect.objectContaining({ accountId: payables.id, debit: 59_000n, credit: 0n }),
  );
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
