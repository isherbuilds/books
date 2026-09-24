import { beforeAll, expect, test } from "bun:test";

import type { AppRouterClient } from "@accly/api/routers/index";
import { db } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { documents } from "@accly/db/schema/documents";
import { items } from "@accly/db/schema/items";
import { eq } from "drizzle-orm";

import { createAccountingFixture, postingOf } from "../support/accounting";
import { required } from "../support/assert";
import {
  createFounderSession,
  createTestUser,
  joinOrganization,
  type TestUser,
} from "../support/auth";
import { clientFor, expectORPCCode, expectReason } from "../support/client";
import { resetTestDatabase } from "../support/database";
import { uniqueSuffix } from "../support/unique";

type Account = typeof accounts.$inferSelect;

type Item = typeof items.$inferSelect;

// The tax flag drives GST returns, not a screen, so invoice.get does not return it.
async function affectsTaxOf(documentId: string) {
  const [stored] = await db
    .select({ affectsTax: documents.affectsTax })
    .from(documents)
    .where(eq(documents.id, documentId));

  return required(stored, "stored invoice").affectsTax;
}

let founder: TestUser;

let organization: { id: string; slug: string };

let api: AppRouterClient;

let party: { id: string };

let taxableItem: Item;

let exemptItem: Item;

let taxableIncome: Account;

let exemptIncome: Account;

let receivables: Account;

let cgstOutput: Account;

let sgstOutput: Account;

let igstOutput: Account;

let roundOff: Account;

beforeAll(async () => {
  await resetTestDatabase();
  founder = await createFounderSession();

  const fixture = await createAccountingFixture(founder, "invoice", {
    gstin: "27ABCDE1234F1Z5",
    stateCode: "27",
    pan: "ABCDE1234F",
  });

  organization = fixture.organization;
  api = fixture.api;

  taxableIncome = required(
    fixture.accounts.find(
      ({ type, supplyClass }) => type === "income" && supplyClass === "taxable",
    ),
    "taxable income account",
  );
  exemptIncome = required(
    fixture.accounts.find(({ type, supplyClass }) => type === "income" && supplyClass === "exempt"),
    "exempt income account",
  );
  receivables = required(
    fixture.accounts.find(({ systemKey }) => systemKey === "receivables"),
    "receivables account",
  );
  cgstOutput = required(
    fixture.accounts.find(({ systemKey }) => systemKey === "cgstOutput"),
    "CGST output account",
  );
  sgstOutput = required(
    fixture.accounts.find(({ systemKey }) => systemKey === "sgstOutput"),
    "SGST output account",
  );
  igstOutput = required(
    fixture.accounts.find(({ systemKey }) => systemKey === "igstOutput"),
    "IGST output account",
  );
  roundOff = required(
    fixture.accounts.find(({ systemKey }) => systemKey === "roundOff"),
    "round-off account",
  );

  party = await api.party.create({
    orgSlug: organization.slug,
    name: "Maharashtra Customer",
    roles: ["customer"],
    stateCode: "27",
    addressLine1: "2 Customer Road",
    city: "Pune",
    pinCode: "411001",
  });

  [taxableItem, exemptItem] = await Promise.all([
    api.item.create({
      orgSlug: organization.slug,
      name: "Taxable consulting",
      hsnSac: "9983",
      unit: "hour",
      unitPrice: "1000.00",
      incomeAccountId: taxableIncome.id,
      taxCode: "GST18",
    }),
    api.item.create({
      orgSlug: organization.slug,
      name: "Exempt service",
      unit: "service",
      unitPrice: "500.00",
      incomeAccountId: exemptIncome.id,
    }),
  ]);
});

test("items enforce the income account tax policy and normalized name uniqueness", async () => {
  expect(taxableItem).toMatchObject({
    name: "Taxable consulting",
    unitPricePaise: 100_000n,
    incomeAccountId: taxableIncome.id,
    taxCode: "GST18",
  });
  expect(exemptItem).toMatchObject({
    name: "Exempt service",
    unitPricePaise: 50_000n,
    incomeAccountId: exemptIncome.id,
    taxCode: null,
  });

  await expectReason(
    api.item.create({
      orgSlug: organization.slug,
      name: "Taxable without a rate",
      unitPrice: "1.00",
      incomeAccountId: taxableIncome.id,
    }),
    "TAX_CODE_REQUIRED",
  );

  const collision = await expectORPCCode(
    api.item.create({
      orgSlug: organization.slug,
      name: "  TAXABLE CONSULTING  ",
      unitPrice: "1.00",
      incomeAccountId: taxableIncome.id,
      taxCode: "GST18",
    }),
    "CONFLICT",
  );

  expect(collision.data).toMatchObject({ reason: "ITEM_NAME_TAKEN" });
});

test("a new item accepts its first edit with the loaded token and refuses that token after", async () => {
  const fields = {
    orgSlug: organization.slug,
    name: "Token checked service",
    unitPrice: "10.00",
    incomeAccountId: exemptIncome.id,
  };

  const created = await api.item.create(fields);
  const loaded = created.updatedAt.toISOString();

  const updated = await api.item.update({
    ...fields,
    itemId: created.id,
    updatedAt: loaded,
    unitPrice: "12.00",
  });

  expect(updated).toMatchObject({ id: created.id, unitPricePaise: 1_200n });

  await expectORPCCode(
    api.item.update({ ...fields, itemId: created.id, updatedAt: loaded, unitPrice: "15.00" }),
    "CONFLICT",
  );
});

test("an intra-state invoice stores component tax, posts a balanced receivable and cancels once", async () => {
  const posted = await api.invoice.post({
    orgSlug: organization.slug,
    partyId: party.id,
    placeOfSupplyStateCode: "27",
    documentDate: "2026-09-12",
    dueDate: "2026-09-30",
    reference: "INV-PRIMARY",
    lines: [
      { kind: "item", itemId: taxableItem.id, quantity: 2 },
      { kind: "item", itemId: exemptItem.id, quantity: 1 },
      {
        kind: "account",
        accountId: exemptIncome.id,
        description: "Exempt professional fee",
        amount: "250.00",
      },
    ],
  });

  expect(posted.number.startsWith("INV")).toBe(true);
  await expectORPCCode(
    api.journal.get({ orgSlug: organization.slug, journalId: posted.id }),
    "NOT_FOUND",
  );

  const detail = await api.invoice.get({
    orgSlug: organization.slug,
    invoiceId: posted.id,
  });

  const posting = await postingOf(organization.id, posted.id, "post");

  expect(detail).toMatchObject({
    id: posted.id,
    number: posted.number,
    state: "posted",
    totalPaise: 311_000n,
    roundOffPaise: 0n,
    placeOfSupplyStateCode: "27",
    partyName: "Maharashtra Customer",
    printClass: "taxInvoice",
  });
  expect(await affectsTaxOf(posted.id)).toBe(true);

  expect(detail.lines).toHaveLength(3);
  expect(detail.lines).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "item",
        itemId: taxableItem.id,
        accountId: taxableIncome.id,
        quantity: 2,
        unitPricePaise: 100_000n,
        amountPaise: 200_000n,
        cgstPaise: 18_000n,
        sgstPaise: 18_000n,
        igstPaise: 0n,
      }),
      expect.objectContaining({
        kind: "item",
        itemId: exemptItem.id,
        accountId: exemptIncome.id,
        quantity: 1,
        amountPaise: 50_000n,
        cgstPaise: 0n,
        sgstPaise: 0n,
        igstPaise: 0n,
      }),
      expect.objectContaining({
        kind: "account",
        itemId: null,
        accountId: exemptIncome.id,
        amountPaise: 25_000n,
        cgstPaise: 0n,
        sgstPaise: 0n,
        igstPaise: 0n,
      }),
    ]),
  );

  expect(posting.entry.documentType).toBe("invoice");
  expect(posting.lines).toHaveLength(5);
  expect(posting.lines).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        accountId: receivables.id,
        partyId: party.id,
        debit: 311_000n,
        credit: 0n,
      }),
      expect.objectContaining({
        accountId: taxableIncome.id,
        partyId: null,
        debit: 0n,
        credit: 200_000n,
      }),
      expect.objectContaining({
        accountId: exemptIncome.id,
        partyId: null,
        debit: 0n,
        credit: 75_000n,
      }),
      expect.objectContaining({
        accountId: cgstOutput.id,
        partyId: null,
        debit: 0n,
        credit: 18_000n,
      }),
      expect.objectContaining({
        accountId: sgstOutput.id,
        partyId: null,
        debit: 0n,
        credit: 18_000n,
      }),
    ]),
  );
  expect(posting.ledger).toEqual([
    expect.objectContaining({
      partyId: party.id,
      side: "receivable",
      kind: "post",
      amountPaise: 311_000n,
    }),
  ]);

  const listed = await api.invoice.list({ orgSlug: organization.slug, q: "INV-PRIMARY" });
  expect(listed).toMatchObject({ hasMore: false });
  expect(listed.rows).toEqual([
    expect.objectContaining({
      id: posted.id,
      number: posted.number,
      totalPaise: 311_000n,
      partyName: "Maharashtra Customer",
      reference: "INV-PRIMARY",
    }),
  ]);

  const cancelled = await api.invoice.cancel({
    orgSlug: organization.slug,
    invoiceId: posted.id,
    reason: "entered twice",
  });

  expect(cancelled.state).toBe("cancelled");

  const reversal = await postingOf(organization.id, posted.id, "reverse");
  expect(reversal.entry.reversesEntryId).toBe(posting.entry.id);
  expect(reversal.ledger).toContainEqual(
    expect.objectContaining({
      partyId: party.id,
      side: "receivable",
      kind: "reverse",
      amountPaise: -311_000n,
    }),
  );

  await expectORPCCode(
    api.invoice.cancel({
      orgSlug: organization.slug,
      invoiceId: posted.id,
      reason: "again",
    }),
    "CONFLICT",
  );
});

test("a registered organization cannot invoice a taxable account line without a rate", async () => {
  await expectReason(
    api.invoice.post({
      orgSlug: organization.slug,
      partyId: party.id,
      placeOfSupplyStateCode: "27",
      lines: [
        {
          kind: "account",
          accountId: taxableIncome.id,
          description: "Untaxed sale",
          amount: "500.00",
        },
      ],
    }),
    "TAXABLE_ACCOUNT_LINE",
  );
});

test("an editable inter-state place of supply overrides the Party state", async () => {
  const posted = await api.invoice.post({
    orgSlug: organization.slug,
    partyId: party.id,
    placeOfSupplyStateCode: "29",
    documentDate: "2026-09-12",
    lines: [
      {
        kind: "item",
        itemId: taxableItem.id,
        quantity: 1,
        unitPrice: "999.99",
      },
    ],
  });

  const detail = await api.invoice.get({ orgSlug: organization.slug, invoiceId: posted.id });
  const posting = await postingOf(organization.id, posted.id, "post");

  expect(detail).toMatchObject({
    totalPaise: 118_000n,
    roundOffPaise: 1n,
    placeOfSupplyStateCode: "29",
  });
  expect(await affectsTaxOf(posted.id)).toBe(true);
  expect(detail.lines).toEqual([
    expect.objectContaining({
      itemId: taxableItem.id,
      amountPaise: 99_999n,
      cgstPaise: 0n,
      sgstPaise: 0n,
      igstPaise: 18_000n,
    }),
  ]);
  expect(posting.lines).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ accountId: receivables.id, debit: 118_000n, credit: 0n }),
      expect.objectContaining({ accountId: taxableIncome.id, debit: 0n, credit: 99_999n }),
      expect.objectContaining({ accountId: igstOutput.id, debit: 0n, credit: 18_000n }),
      expect.objectContaining({ accountId: roundOff.id, debit: 0n, credit: 1n }),
    ]),
  );
});

test("a draft uses optimistic versions and posts into the same document", async () => {
  const fields = {
    orgSlug: organization.slug,
    partyId: party.id,
    placeOfSupplyStateCode: "27",
    documentDate: "2026-09-12",
    reference: "DRAFT-ONE",
    lines: [{ kind: "item" as const, itemId: exemptItem.id, quantity: 1 }],
  };

  const draft = await api.invoice.saveDraft(fields);
  expect(draft).toMatchObject({ version: 1 });

  const draftDetail = await api.invoice.get({
    orgSlug: organization.slug,
    invoiceId: draft.id,
  });

  expect(draftDetail).toMatchObject({ id: draft.id, state: "draft", number: null, version: 1 });

  const updated = await api.invoice.saveDraft({
    ...fields,
    draft: { id: draft.id, version: 1 },
    reference: "DRAFT-TWO",
  });

  expect(updated).toEqual({ id: draft.id, version: 2 });

  await expectORPCCode(
    api.invoice.post({ ...fields, draft: { id: draft.id, version: 1 } }),
    "CONFLICT",
  );

  const posted = await api.invoice.post({
    ...fields,
    draft: { id: draft.id, version: 2 },
    reference: "DRAFT-TWO",
  });

  expect(posted.id).toBe(draft.id);
  expect(posted.number.startsWith("INV")).toBe(true);
  expect(await api.invoice.get({ orgSlug: organization.slug, invoiceId: posted.id })).toMatchObject(
    { id: draft.id, state: "posted", number: posted.number },
  );
});

test("a draft is discarded only with its current version", async () => {
  const draft = await api.invoice.saveDraft({
    orgSlug: organization.slug,
    partyId: party.id,
    placeOfSupplyStateCode: "27",
    lines: [{ kind: "item" as const, itemId: exemptItem.id, quantity: 1 }],
  });

  const claim = { orgSlug: organization.slug, draft: { id: draft.id, version: 2 } };

  await expectORPCCode(api.invoice.discardDraft(claim), "CONFLICT");
  await api.invoice.discardDraft({ ...claim, draft });
  await expectORPCCode(
    api.invoice.get({ orgSlug: organization.slug, invoiceId: draft.id }),
    "NOT_FOUND",
  );
});

test("an invoice that totals nothing is refused", async () => {
  const free = await api.item.create({
    orgSlug: organization.slug,
    name: "Free sample",
    unitPrice: "0.00",
    incomeAccountId: exemptIncome.id,
  });

  await expectReason(
    api.invoice.post({
      orgSlug: organization.slug,
      partyId: party.id,
      placeOfSupplyStateCode: "27",
      lines: [{ kind: "item", itemId: free.id, quantity: 3 }],
    }),
    "INVOICE_ZERO_TOTAL",
  );
});

test("an operator may post but not cancel while a CA cannot post", async () => {
  const operator = await createTestUser(`invoice-operator-${uniqueSuffix()}`);
  const ca = await createTestUser(`invoice-ca-${uniqueSuffix()}`);
  await joinOrganization(operator, organization.id, "operator");
  await joinOrganization(ca, organization.id, "ca");

  const operatorInvoice = await clientFor(operator).invoice.post({
    orgSlug: organization.slug,
    partyId: party.id,
    placeOfSupplyStateCode: "27",
    documentDate: "2026-09-12",
    lines: [{ kind: "item", itemId: exemptItem.id, quantity: 1, unitPrice: "1.00" }],
  });

  await expectORPCCode(
    clientFor(operator).invoice.cancel({
      orgSlug: organization.slug,
      invoiceId: operatorInvoice.id,
      reason: "not permitted",
    }),
    "FORBIDDEN",
  );
  await expectORPCCode(
    clientFor(ca).invoice.post({
      orgSlug: organization.slug,
      partyId: party.id,
      placeOfSupplyStateCode: "27",
      lines: [{ kind: "item", itemId: exemptItem.id, quantity: 1 }],
    }),
    "FORBIDDEN",
  );
});

test("an unregistered organization invoices a date with no effective rate", async () => {
  const unregistered = await createAccountingFixture(founder, "invoice-unregistered");

  const income = required(
    unregistered.accounts.find(
      ({ type, supplyClass }) => type === "income" && supplyClass === "taxable",
    ),
    "taxable income account",
  );

  const [customer, item] = await Promise.all([
    unregistered.api.party.create({
      orgSlug: unregistered.organization.slug,
      name: "Unregistered Customer",
      roles: ["customer"],
      stateCode: "27",
      addressLine1: "3 Customer Road",
      city: "Pune",
      pinCode: "411001",
    }),
    unregistered.api.item.create({
      orgSlug: unregistered.organization.slug,
      name: "Late rate consulting",
      unit: "hour",
      unitPrice: "1000.00",
      incomeAccountId: income.id,
      // GST40 only starts on 2025-09-22, so the invoice date below resolves no rate.
      taxCode: "GST40",
    }),
  ]);

  const posted = await unregistered.api.invoice.post({
    orgSlug: unregistered.organization.slug,
    partyId: customer.id,
    placeOfSupplyStateCode: "27",
    documentDate: "2025-04-01",
    lines: [{ kind: "item", itemId: item.id, quantity: 1 }],
  });

  const detail = await unregistered.api.invoice.get({
    orgSlug: unregistered.organization.slug,
    invoiceId: posted.id,
  });

  expect(detail).toMatchObject({ totalPaise: 100_000n, printClass: "billOfSupply" });
  expect(detail.lines).toEqual([
    expect.objectContaining({ unit: "hour", cgstPaise: 0n, sgstPaise: 0n, igstPaise: 0n }),
  ]);
});

test("a line amount beyond the storable range is refused, not left to the database", async () => {
  await expectReason(
    api.invoice.post({
      orgSlug: organization.slug,
      partyId: party.id,
      placeOfSupplyStateCode: "27",
      lines: [
        {
          kind: "item",
          itemId: taxableItem.id,
          quantity: 1_000_000,
          unitPrice: "9999999999999.99",
        },
      ],
    }),
    "INVOICE_AMOUNT_TOO_LARGE",
  );
});
