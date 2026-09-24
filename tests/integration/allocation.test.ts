import { beforeAll, expect, test } from "bun:test";

import { businessDate } from "@accly/api/lib/business-date";
import type { AppRouterClient } from "@accly/api/routers/index";
import { db } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { items } from "@accly/db/schema/items";
import { journalEntries } from "@accly/db/schema/journal-entries";
import { journalLines } from "@accly/db/schema/journal-lines";
import { paymentMethods } from "@accly/db/schema/payment-methods";
import { and, eq, inArray } from "drizzle-orm";

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

type PaymentMethod = typeof paymentMethods.$inferSelect;

const FIXTURE_TIME_ZONE = "UTC";

let founder: TestUser;

let organization: { id: string; slug: string };

let api: AppRouterClient;

let party: { id: string };

let exemptItem: Item;

let receivables: Account;

let customerAdvances: Account;

let bankAccount: Account;

let bankTransfer: PaymentMethod;

async function postInvoice(
  amount: string,
  fields: { dueDate?: string; documentDate?: string } = {},
) {
  return api.invoice.post({
    orgSlug: organization.slug,
    partyId: party.id,
    documentDate: fields.documentDate ?? "2026-09-10",
    dueDate: fields.dueDate,
    placeOfSupplyStateCode: "27",
    lines: [{ kind: "item", itemId: exemptItem.id, quantity: 1, unitPrice: amount }],
  });
}

async function postAdvance(amount: string) {
  return api.receipt.post({
    orgSlug: organization.slug,
    settlementKind: "advance",
    partyId: party.id,
    amount,
    paymentMethodId: bankTransfer.id,
    advanceSupply: "exempt",
  });
}

beforeAll(async () => {
  await resetTestDatabase();
  founder = await createFounderSession();

  const fixture = await createAccountingFixture(founder, "allocation", {
    gstin: "27ABCDE1234F1Z5",
    stateCode: "27",
    pan: "ABCDE1234F",
    timeZone: FIXTURE_TIME_ZONE,
  });

  organization = fixture.organization;
  api = fixture.api;
  receivables = required(
    fixture.accounts.find(({ systemKey }) => systemKey === "receivables"),
    "receivables account",
  );
  customerAdvances = required(
    fixture.accounts.find(({ systemKey }) => systemKey === "customerAdvances"),
    "customer advances account",
  );
  bankTransfer = required(
    fixture.methods.find(({ name }) => name === "Bank transfer"),
    "bank transfer payment method",
  );
  bankAccount = required(
    fixture.accounts.find(({ id }) => id === bankTransfer.accountId),
    "bank transfer account",
  );

  const exemptIncome = required(
    fixture.accounts.find(({ type, supplyClass }) => type === "income" && supplyClass === "exempt"),
    "exempt income account",
  );

  party = await api.party.create({
    orgSlug: organization.slug,
    name: "Allocation Customer",
    roles: ["customer"],
    stateCode: "27",
    addressLine1: "4 Settlement Road",
    city: "Pune",
    pinCode: "411001",
  });
  exemptItem = await api.item.create({
    orgSlug: organization.slug,
    name: "Exempt allocation service",
    unit: "service",
    unitPrice: "1.00",
    incomeAccountId: exemptIncome.id,
  });
});

test("an against receipt settles invoices, applies and reverses its advance, then cancels cleanly", async () => {
  const [firstInvoice, secondInvoice, spareInvoice] = await Promise.all([
    postInvoice("6000.00"),
    postInvoice("4000.00"),
    postInvoice("100.00"),
  ]);

  const receipt = await api.receipt.post({
    orgSlug: organization.slug,
    settlementKind: "against",
    partyId: party.id,
    amount: "10000.00",
    paymentMethodId: bankTransfer.id,
    documentDate: "2026-09-12",
    allocations: [
      { invoiceId: firstInvoice.id, amount: "6000.00" },
      { invoiceId: secondInvoice.id, amount: "3000.00" },
    ],
    advanceSupply: "exempt",
  });

  const receiptPost = await postingOf(organization.id, receipt.id, "post");
  expect(receiptPost.lines).toHaveLength(3);
  expect(receiptPost.lines).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        accountId: bankAccount.id,
        partyId: null,
        debit: 1_000_000n,
        credit: 0n,
      }),
      expect.objectContaining({
        accountId: receivables.id,
        partyId: party.id,
        debit: 0n,
        credit: 900_000n,
      }),
      expect.objectContaining({
        accountId: customerAdvances.id,
        partyId: party.id,
        debit: 0n,
        credit: 100_000n,
      }),
    ]),
  );

  const [first, second, detail, unapplied] = await Promise.all([
    api.invoice.get({ orgSlug: organization.slug, invoiceId: firstInvoice.id }),
    api.invoice.get({ orgSlug: organization.slug, invoiceId: secondInvoice.id }),
    api.receipt.get({ orgSlug: organization.slug, receiptId: receipt.id }),
    api.receipt.unapplied({ orgSlug: organization.slug, partyId: party.id }),
  ]);

  expect(first).toMatchObject({
    outstandingPaise: 0n,
    settlementStatus: "paid",
    overdue: false,
  });
  expect(second).toMatchObject({
    outstandingPaise: 100_000n,
    settlementStatus: "partPaid",
    overdue: false,
  });
  expect(detail.allocations).toHaveLength(2);
  expect(detail.allocations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        targetDocumentId: firstInvoice.id,
        targetNumber: firstInvoice.number,
        amountPaise: 600_000n,
        reversed: false,
      }),
      expect.objectContaining({
        targetDocumentId: secondInvoice.id,
        targetNumber: secondInvoice.number,
        amountPaise: 300_000n,
        reversed: false,
      }),
    ]),
  );
  expect(unapplied.rows).toContainEqual(
    expect.objectContaining({ id: receipt.id, unappliedPaise: 100_000n }),
  );

  const postTimeAllocationId = required(
    detail.allocations.find(({ targetDocumentId }) => targetDocumentId === firstInvoice.id),
    "post-time allocation to the first invoice",
  ).id;

  const activeAtCancelId = required(
    detail.allocations.find(({ targetDocumentId }) => targetDocumentId === secondInvoice.id),
    "post-time allocation to the second invoice",
  ).id;

  const [applied] = await api.allocation.apply({
    orgSlug: organization.slug,
    receiptId: receipt.id,
    invoiceId: secondInvoice.id,
    amount: "1000.00",
  });

  const appliedAllocation = required(applied, "applied allocation");
  expect(appliedAllocation).toMatchObject({ amountPaise: 100_000n });

  const appliedPost = await postingOf(organization.id, appliedAllocation.id, "post");
  expect(appliedPost.entry.documentType).toBe("allocation");
  expect(appliedPost.lines).toHaveLength(2);
  expect(appliedPost.lines).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        accountId: customerAdvances.id,
        partyId: party.id,
        debit: 100_000n,
        credit: 0n,
      }),
      expect.objectContaining({
        accountId: receivables.id,
        partyId: party.id,
        debit: 0n,
        credit: 100_000n,
      }),
    ]),
  );
  expect(
    await api.invoice.get({ orgSlug: organization.slug, invoiceId: secondInvoice.id }),
  ).toMatchObject({ outstandingPaise: 0n, settlementStatus: "paid" });

  // Keep the target open so the exhausted receipt is the failing boundary.
  await expectReason(
    api.allocation.apply({
      orgSlug: organization.slug,
      receiptId: receipt.id,
      invoiceId: spareInvoice.id,
      amount: "0.01",
    }),
    "ALLOCATION_EXCEEDS_SOURCE",
  );

  await expectORPCCode(
    api.invoice.cancel({
      orgSlug: organization.slug,
      invoiceId: firstInvoice.id,
      reason: "allocated invoice cannot be cancelled",
    }),
    "CONFLICT",
  );

  const reversed = await api.allocation.reverse({
    orgSlug: organization.slug,
    allocationId: appliedAllocation.id,
    reason: "allocation entered in error",
  });

  expect(reversed).toMatchObject({ amountPaise: 100_000n });
  expect(
    (await postingOf(organization.id, appliedAllocation.id, "reverse")).entry.reversesEntryId,
  ).toBe(appliedPost.entry.id);
  expect(
    await api.invoice.get({ orgSlug: organization.slug, invoiceId: secondInvoice.id }),
  ).toMatchObject({ outstandingPaise: 100_000n, settlementStatus: "partPaid" });

  await expectORPCCode(
    api.allocation.reverse({
      orgSlug: organization.slug,
      allocationId: appliedAllocation.id,
      reason: "again",
    }),
    "CONFLICT",
  );

  const reason = "receipt allocation entered in error";
  await api.allocation.reverse({
    orgSlug: organization.slug,
    allocationId: postTimeAllocationId,
    reason,
  });

  const postTimeReversal = await postingOf(organization.id, postTimeAllocationId, "post");
  expect(postTimeReversal.entry).toMatchObject({
    documentType: "allocation",
    documentId: postTimeAllocationId,
    reversesEntryId: null,
    narration: reason,
  });
  expect(postTimeReversal.lines).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        accountId: receivables.id,
        partyId: party.id,
        debit: 600_000n,
        credit: 0n,
      }),
      expect.objectContaining({
        accountId: customerAdvances.id,
        partyId: party.id,
        debit: 0n,
        credit: 600_000n,
      }),
    ]),
  );
  expect(
    await api.invoice.get({ orgSlug: organization.slug, invoiceId: firstInvoice.id }),
  ).toMatchObject({ outstandingPaise: 600_000n, settlementStatus: "unpaid" });

  await api.receipt.cancel({
    orgSlug: organization.slug,
    receiptId: receipt.id,
    reason: "receipt entered in error",
  });

  expect((await postingOf(organization.id, receipt.id, "reverse")).entry.reversesEntryId).toBe(
    receiptPost.entry.id,
  );

  const [firstAfterCancel, secondAfterCancel] = await Promise.all([
    api.invoice.get({ orgSlug: organization.slug, invoiceId: firstInvoice.id }),
    api.invoice.get({ orgSlug: organization.slug, invoiceId: secondInvoice.id }),
  ]);

  expect(firstAfterCancel).toMatchObject({
    outstandingPaise: 600_000n,
    settlementStatus: "unpaid",
  });
  expect(secondAfterCancel).toMatchObject({
    outstandingPaise: 400_000n,
    settlementStatus: "unpaid",
  });

  const lines = await db
    .select({
      documentId: journalEntries.documentId,
      accountId: journalLines.accountId,
      debit: journalLines.debit,
      credit: journalLines.credit,
    })
    .from(journalLines)
    .innerJoin(
      journalEntries,
      and(eq(journalEntries.orgId, organization.id), eq(journalEntries.id, journalLines.entryId)),
    )
    .where(
      and(
        eq(journalLines.orgId, organization.id),
        inArray(journalEntries.documentId, [
          receipt.id,
          postTimeAllocationId,
          activeAtCancelId,
          appliedAllocation.id,
        ]),
      ),
    );

  // An allocation made at post has no entry of its own, so cancelling the receipt must
  // not post one for it only to reverse it.
  expect(lines.some(({ documentId }) => documentId === activeAtCancelId)).toBe(false);

  const balances = new Map<string, bigint>();

  for (const line of lines) {
    balances.set(line.accountId, (balances.get(line.accountId) ?? 0n) + line.debit - line.credit);
  }

  expect(balances.get(receivables.id)).toBe(0n);
  expect(balances.get(customerAdvances.id)).toBe(0n);
  expect(balances.get(bankAccount.id)).toBe(0n);
});

test("an invoice due yesterday is overdue and appears in the overdue filter", async () => {
  const now = Date.now();
  const yesterday = businessDate(new Date(now - 86_400_000), FIXTURE_TIME_ZONE);

  const overdueInvoice = await postInvoice("100.00", {
    dueDate: yesterday,
    documentDate: businessDate(new Date(now - 2 * 86_400_000), FIXTURE_TIME_ZONE),
  });

  const detail = await api.invoice.get({
    orgSlug: organization.slug,
    invoiceId: overdueInvoice.id,
  });

  expect(detail).toMatchObject({
    dueDate: yesterday,
    outstandingPaise: 10_000n,
    settlementStatus: "unpaid",
    overdue: true,
  });

  const listed = await api.invoice.list({
    orgSlug: organization.slug,
    settlement: "overdue",
  });

  expect(listed.rows).toEqual([
    expect.objectContaining({
      id: overdueInvoice.id,
      outstandingPaise: 10_000n,
      settlementStatus: "unpaid",
      overdue: true,
    }),
  ]);
});

test("a direct receipt is neither listed nor accepted as an allocation source", async () => {
  const [direct, invoice] = await Promise.all([
    api.receipt.post({
      orgSlug: organization.slug,
      settlementKind: "direct",
      partyId: party.id,
      amount: "100.00",
      paymentMethodId: bankTransfer.id,
      incomeAccountId: exemptItem.incomeAccountId,
    }),
    postInvoice("100.00"),
  ]);

  await expectReason(
    api.allocation.apply({
      orgSlug: organization.slug,
      receiptId: direct.id,
      invoiceId: invoice.id,
      amount: "100.00",
    }),
    "ALLOCATION_SOURCE_INVALID",
  );

  const unapplied = await api.receipt.unapplied({
    orgSlug: organization.slug,
    partyId: party.id,
  });

  expect(unapplied.rows.map(({ id }) => id)).not.toContain(direct.id);
});

test("two concurrent applies cannot spend one advance twice", async () => {
  const [advance, first, second] = await Promise.all([
    postAdvance("500.00"),
    postInvoice("500.00"),
    postInvoice("500.00"),
  ]);

  const outcomes = await Promise.allSettled(
    [first, second].map((invoice) =>
      api.allocation.apply({
        orgSlug: organization.slug,
        receiptId: advance.id,
        invoiceId: invoice.id,
        amount: "500.00",
      }),
    ),
  );

  const refused = outcomes.filter(
    (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
  );

  expect(refused).toHaveLength(1);
  expect(refused[0]?.reason).toHaveProperty("data.reason", "ALLOCATION_EXCEEDS_SOURCE");
});

test("an operator cannot apply an allocation", async () => {
  const operator = await createTestUser(`allocation-operator-${uniqueSuffix()}`);
  await joinOrganization(operator, organization.id, "operator");

  // The permission guard refuses before any id is read.
  await expectORPCCode(
    clientFor(operator).allocation.apply({
      orgSlug: organization.slug,
      receiptId: crypto.randomUUID(),
      invoiceId: crypto.randomUUID(),
      amount: "0.01",
    }),
    "FORBIDDEN",
  );
});

test("an against receipt names what its unallocated remainder is received for", async () => {
  const invoice = await postInvoice("600.00");

  const receipt = {
    orgSlug: organization.slug,
    settlementKind: "against" as const,
    partyId: party.id,
    amount: "1000.00",
    paymentMethodId: bankTransfer.id,
    allocations: [{ invoiceId: invoice.id, amount: "600.00" }],
  };

  await expectReason(api.receipt.post(receipt), "ADVANCE_SUPPLY_REQUIRED");
  // Fully allocated: nothing is held as an advance, so no supply is asked for.
  await api.receipt.post({ ...receipt, amount: "600.00" });
});
