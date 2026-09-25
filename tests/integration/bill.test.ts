import { beforeAll, expect, test } from "bun:test";

import type { AppRouterClient } from "@accly/api/routers/index";
import { db } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { tdsSections } from "@accly/db/schema/tds-sections";
import { and, eq } from "drizzle-orm";

import { createAccountingFixture, postingOf } from "../support/accounting";
import { required } from "../support/assert";
import { createFounderSession, type TestUser } from "../support/auth";
import { expectReason } from "../support/client";
import { resetTestDatabase } from "../support/database";

type Account = typeof accounts.$inferSelect;

let founder: TestUser;

let organization: { id: string; slug: string };

let api: AppRouterClient;

let vendor: { id: string };

let expense: Account;

let cgstInput: Account;

let sgstInput: Account;

let tdsPayable: Account;

let payables: Account;

let tdsSectionId: string;

beforeAll(async () => {
  await resetTestDatabase();
  founder = await createFounderSession();

  const fixture = await createAccountingFixture(founder, "bill", {
    gstin: "27ABCDE1234F1Z5",
    stateCode: "27",
    pan: "ABCDE1234F",
  });

  organization = fixture.organization;
  api = fixture.api;
  expense = required(
    fixture.accounts.find(({ type, systemKey }) => type === "expense" && systemKey === null),
    "expense account",
  );
  cgstInput = required(
    fixture.accounts.find(({ systemKey }) => systemKey === "cgstInput"),
    "CGST input account",
  );
  sgstInput = required(
    fixture.accounts.find(({ systemKey }) => systemKey === "sgstInput"),
    "SGST input account",
  );
  tdsPayable = required(
    fixture.accounts.find(({ systemKey }) => systemKey === "tdsPayable"),
    "TDS payable account",
  );
  payables = required(
    fixture.accounts.find(({ systemKey }) => systemKey === "payables"),
    "payables account",
  );
  vendor = await api.party.create({
    orgSlug: organization.slug,
    name: "Bill Supplier",
    roles: ["vendor"],
    stateCode: "27",
    pan: "ABCDE1234F",
  });
  tdsSectionId = required(
    (
      await db
        .select()
        .from(tdsSections)
        .where(and(eq(tdsSections.orgId, organization.id), eq(tdsSections.code, "1024")))
    ).find(({ effectiveTo }) => effectiveTo === null),
    "current 1024 TDS section",
  ).id;
});

test("bill splits eligible and ineligible input GST and deducts TDS from payable capacity", async () => {
  const posted = await api.bill.post({
    orgSlug: organization.slug,
    partyId: vendor.id,
    documentDate: "2026-09-12",
    dueDate: "2026-09-30",
    reference: "SUP-0001",
    tdsSectionId,
    lines: [
      {
        accountId: expense.id,
        description: "Eligible services",
        amount: "1000.00",
        taxCode: "GST18",
        itcEligible: true,
      },
      {
        accountId: expense.id,
        description: "Ineligible services",
        amount: "500.00",
        taxCode: "GST18",
        itcEligible: false,
      },
    ],
  });

  const detail = await api.bill.get({ orgSlug: organization.slug, billId: posted.id });
  expect(detail).toMatchObject({
    id: posted.id,
    state: "posted",
    reference: "SUP-0001",
    totalPaise: 177_000n,
    capacityPaise: 174_000n,
    outstandingPaise: 174_000n,
    settlementStatus: "unpaid",
    tds: { sectionCode: "1024", basePaise: 150_000n, amountPaise: 3_000n },
  });
  expect(detail.lines).toEqual([
    expect.objectContaining({
      taxCode: "GST18",
      amountPaise: 100_000n,
      cgstPaise: 9_000n,
      sgstPaise: 9_000n,
      itcEligible: true,
      rateBasisPoints: 1800,
    }),
    expect.objectContaining({
      taxCode: "GST18",
      amountPaise: 50_000n,
      cgstPaise: 4_500n,
      sgstPaise: 4_500n,
      itcEligible: false,
      rateBasisPoints: 1800,
    }),
  ]);
  const posting = await postingOf(organization.id, posted.id, "post");
  expect(posting.lines).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ accountId: expense.id, debit: 100_000n, credit: 0n }),
      expect.objectContaining({ accountId: expense.id, debit: 59_000n, credit: 0n }),
      expect.objectContaining({ accountId: cgstInput.id, debit: 9_000n, credit: 0n }),
      expect.objectContaining({ accountId: sgstInput.id, debit: 9_000n, credit: 0n }),
      expect.objectContaining({ accountId: tdsPayable.id, debit: 0n, credit: 3_000n }),
      expect.objectContaining({
        accountId: payables.id,
        partyId: vendor.id,
        debit: 0n,
        credit: 174_000n,
      }),
    ]),
  );
  expect(posting.ledger).toContainEqual(
    expect.objectContaining({
      side: "payable",
      kind: "post",
      partyId: vendor.id,
      amountPaise: -174_000n,
    }),
  );

  const listed = await api.bill.list({
    orgSlug: organization.slug,
    settlement: "open",
    q: "SUP-0001",
  });

  expect(listed.rows).toContainEqual(
    expect.objectContaining({
      id: posted.id,
      capacityPaise: 174_000n,
      outstandingPaise: 174_000n,
    }),
  );
});

test("a draft retains its TDS section and dated tax code for editing", async () => {
  const draft = await api.bill.saveDraft({
    orgSlug: organization.slug,
    partyId: vendor.id,
    documentDate: "2026-09-12",
    tdsSectionId,
    lines: [
      {
        accountId: expense.id,
        description: "Taxed service",
        amount: "1000.00",
        taxCode: "GST18",
        itcEligible: true,
      },
    ],
  });

  const detail = await api.bill.get({ orgSlug: organization.slug, billId: draft.id });
  expect(detail).toMatchObject({
    state: "draft",
    tds: { tdsSectionId, sectionCode: "1024", basePaise: 100_000n, amountPaise: 2_000n },
    lines: [expect.objectContaining({ taxCode: "GST18", rateBasisPoints: 1800 })],
  });
});

test("amend cancels the bill and copies its editable data to a linked draft", async () => {
  const posted = await api.bill.post({
    orgSlug: organization.slug,
    partyId: vendor.id,
    reference: "SUP-AMEND",
    documentDate: "2026-09-12",
    lines: [
      {
        accountId: expense.id,
        description: "Correction needed",
        amount: "200.00",
        itcEligible: false,
      },
    ],
  });

  const draft = await api.bill.amend({
    orgSlug: organization.slug,
    billId: posted.id,
    reason: "Wrong supplier reference",
  });

  const original = await api.bill.get({ orgSlug: organization.slug, billId: posted.id });
  const copy = await api.bill.get({ orgSlug: organization.slug, billId: draft.id });
  expect(original.state).toBe("cancelled");
  expect(copy).toMatchObject({
    id: draft.id,
    version: draft.version,
    state: "draft",
    number: null,
    amendedFromId: posted.id,
    reference: "SUP-AMEND",
    partyId: vendor.id,
  });
  expect(copy.lines).toEqual([
    expect.objectContaining({
      accountId: expense.id,
      description: "Correction needed",
      amountPaise: 20_000n,
    }),
  ]);

  const updated = await api.bill.saveDraft({
    orgSlug: organization.slug,
    partyId: vendor.id,
    reference: "SUP-CORRECTED",
    documentDate: "2026-09-12",
    draft,
    lines: [
      { accountId: expense.id, description: "Corrected", amount: "200.00", itcEligible: false },
    ],
  });

  expect(
    (await api.bill.get({ orgSlug: organization.slug, billId: updated.id })).amendedFromId,
  ).toBe(posted.id);
});

test("a TDS section requires the supplier PAN", async () => {
  const withoutPan = await api.party.create({
    orgSlug: organization.slug,
    name: "Supplier without PAN",
    roles: ["vendor"],
    stateCode: "27",
  });

  await expectReason(
    api.bill.post({
      orgSlug: organization.slug,
      partyId: withoutPan.id,
      reference: "SUP-NOPAN",
      documentDate: "2026-09-12",
      tdsSectionId,
      lines: [
        { accountId: expense.id, description: "Labour", amount: "100.00", itcEligible: false },
      ],
    }),
    "TDS_PAN_REQUIRED",
  );
});
