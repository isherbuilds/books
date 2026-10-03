import { expect, spyOn, test } from "bun:test";

import { db } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { documents } from "@accly/db/schema/documents";
import { items } from "@accly/db/schema/items";
import { journalLines } from "@accly/db/schema/journal-lines";
import { partyLedgerLines } from "@accly/db/schema/party-ledger-lines";
import { parties } from "@accly/db/schema/parties";
import { and, count, eq, sql } from "drizzle-orm";
import { openXlsx, saveXlsx, writeXlsx } from "hucre/xlsx";
import pg from "pg";

import { createAccountingFixture } from "../support/accounting";
import { required } from "../support/assert";
import { createFounderSession } from "../support/auth";
import { expectORPCCode } from "../support/client";
import { resetTestDatabase } from "../support/database";

type Cell = string | number | Date | null;

const cutoverTrialBalance: Cell[][] = [
  ["Cash in Hand", 20000, null],
  ["1300", 8000, null],
  ["2000", null, 5000],
  ["Capital Account", null, 23000],
];

const masterRows = {
  accounts: [["Tuition Fees", "Income", "exempt"]],
  parties: [["Priya", "customer", null, null, "27"]],
  items: [["Tuition", "Tuition Fees", 0]],
};

async function workbook(
  trialBalance: Cell[][],
  masters: {
    accounts?: Cell[][];
    parties?: Cell[][];
    items?: Cell[][];
    openingItems?: Cell[][];
  } = {},
): Promise<File> {
  const bytes = await writeXlsx({
    sheets: [
      { name: "Read me", rows: [["Template version", "1"]] },
      { name: "Opening", rows: [["Opening date"], [new Date(Date.UTC(2026, 2, 31))]] },
      {
        name: "Accounts",
        rows: [["Name", "Parent", "GST supply class"], ...(masters.accounts ?? [])],
      },
      {
        name: "Parties",
        rows: [
          [
            "Name",
            "Roles",
            "GSTIN",
            "PAN",
            "State code",
            "Address",
            "City",
            "PIN code",
            "Email",
            "Phone",
          ],
          ...(masters.parties ?? []),
        ],
      },
      {
        name: "Items",
        rows: [
          ["Name", "Income account", "Unit price", "HSN/SAC", "Unit", "Tax code"],
          ...(masters.items ?? []),
        ],
      },
      { name: "Trial balance", rows: [["Account", "Debit", "Credit"], ...trialBalance] },
      {
        name: "Opening items",
        rows: [
          ["Party", "Side", "Type", "Reference", "Date", "Due date", "Amount"],
          ["Priya", "Receivable", "Claim", "INV-88", "2026-02-10", "2026-03-12", 10000],
          ["Priya", "Receivable", "Credit", "ADV-3", "2026-03-01", null, "2000.00"],
          ["Mehta Traders", "Payable", "Claim", "B-17", "2026-03-05", "2026-04-30", 5000],
          ...(masters.openingItems ?? []),
        ],
      },
    ],
  });

  // SAFETY: hucre 1.1.0 ZipWriter.build allocates a new Uint8Array, never a SharedArrayBuffer.
  return new File([bytes as Uint8Array<ArrayBuffer>], "import.xlsx");
}

async function counts(orgId: string) {
  const [[docs], [ledger], [lines], [accountRows], [partyRows], [itemRows]] = await Promise.all([
    db.select({ n: count() }).from(documents).where(eq(documents.orgId, orgId)),
    db.select({ n: count() }).from(partyLedgerLines).where(eq(partyLedgerLines.orgId, orgId)),
    db.select({ n: count() }).from(journalLines).where(eq(journalLines.orgId, orgId)),
    db.select({ n: count() }).from(accounts).where(eq(accounts.orgId, orgId)),
    db.select({ n: count() }).from(parties).where(eq(parties.orgId, orgId)),
    db.select({ n: count() }).from(items).where(eq(items.orgId, orgId)),
  ]);

  return {
    docs: docs!.n,
    ledger: ledger!.n,
    lines: lines!.n,
    accounts: accountRows!.n,
    parties: partyRows!.n,
    items: itemRows!.n,
  };
}

async function accountBalance(orgId: string, accountId: string) {
  const [row] = await db
    .select({
      paise:
        sql<bigint>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)::bigint`.mapWith(
          BigInt,
        ),
    })
    .from(journalLines)
    .where(and(eq(journalLines.orgId, orgId), eq(journalLines.accountId, accountId)));

  return required(row, `balance of ${accountId}`).paise;
}

await resetTestDatabase();

const founder = await createFounderSession();

test("an imported cutover posts control legs and settleable opening items", async () => {
  const fixture = await createAccountingFixture(founder, "import-cutover", {
    legalType: "proprietorship",
  });

  const { api } = fixture;
  const claim = { orgSlug: fixture.organization.slug };

  const byCode = (code: string) =>
    required(
      fixture.accounts.find((account) => account.code === code),
      `account ${code}`,
    );

  const [cash, receivables, payables, capital] = ["1001", "1300", "2000", "3000"].map(byCode);

  const [priya, mehta] = await Promise.all([
    api.party.create({ ...claim, name: "Priya", roles: ["customer"], stateCode: "27" }),
    api.party.create({ ...claim, name: "Mehta Traders", roles: ["vendor"], stateCode: "27" }),
  ]);

  const before = await counts(fixture.organization.id);

  // Failure path: receivables 7,000 against items netting to 8,000.
  const mismatchFile = await workbook([
    ["Cash in Hand", 20000, null],
    ["1300", 7000, null],
    ["2000", null, 5000],
    ["Capital Account", null, 22000],
  ]);

  expect(await api.import.check({ ...claim, file: mismatchFile })).toMatchObject({
    errorCount: 1,
    errors: [{ sheet: "Trial balance", row: null, code: "OPENING_ITEMS_MISMATCH" }],
  });

  const mismatch = await expectORPCCode(
    api.import.commit({ ...claim, file: mismatchFile }),
    "BAD_REQUEST",
  );

  expect(mismatch.data).toMatchObject({ reason: "IMPORT_INVALID" });
  expect(await counts(fixture.organization.id)).toEqual(before);

  const file = await workbook(cutoverTrialBalance);

  const result = await api.import.commit({ ...claim, file });

  expect(result.summary).toMatchObject({
    trialBalanceRows: 4,
    openingClaims: 2,
    openingCredits: 1,
    receivablesPaise: 800000n,
    payablesPaise: 500000n,
  });

  const sheet = [
    [cash!, 2000000n],
    [receivables!, 800000n],
    [payables!, -500000n],
    [capital!, -2300000n],
  ] as const;

  for (const [account, paise] of sheet)
    expect(await accountBalance(fixture.organization.id, account.id)).toBe(paise);

  const [priyaStatement, mehtaStatement] = await Promise.all([
    api.party.statement({ ...claim, partyId: priya.id }),
    api.party.statement({ ...claim, partyId: mehta.id }),
  ]);

  expect(priyaStatement.closingPaise).toBe(800000n);
  expect(mehtaStatement.closingPaise).toBe(-500000n);
  expect(priyaStatement.lines.map((line) => [line.entryDate, line.typeLabel])).toEqual([
    ["2026-03-31", "Opening invoice"],
    ["2026-03-31", "Opening credit"],
  ]);
  expect(mehtaStatement.lines[0]!.typeLabel).toBe("Opening bill");

  const [openItems, openCredits, payableItems] = await Promise.all([
    api.party.openItems({ ...claim, partyId: priya.id, side: "receivable", limit: 25 }),
    api.party.openCredits({ ...claim, partyId: priya.id, side: "receivable", limit: 25 }),
    api.party.openItems({ ...claim, partyId: mehta.id, side: "payable", limit: 25 }),
  ]);

  const inv88 = required(openItems.rows[0], "INV-88");
  const adv3 = required(openCredits.rows[0], "ADV-3");
  const b17 = required(payableItems.rows[0], "B-17");
  expect(inv88).toMatchObject({
    reference: "INV-88",
    dueDate: "2026-03-12",
    outstandingPaise: 1000000n,
  });
  expect(inv88.number).toMatch(/^OC25-26\/\d+$/);
  expect(adv3).toMatchObject({ reference: "ADV-3", unappliedPaise: 200000n });
  expect(adv3.number).toBe("OA25-26/1");

  const imported = await db
    .select({ financialYear: documents.financialYear })
    .from(documents)
    .where(and(eq(documents.orgId, fixture.organization.id), eq(documents.id, adv3.id)));

  expect(imported).toEqual([{ financialYear: "2025-26" }]);

  const linesBeforeApply = (await counts(fixture.organization.id)).lines;

  const [applied] = await api.allocation.apply({
    ...claim,
    sourceDocumentId: adv3.id,
    targetDocumentId: inv88.id,
    amount: "2000.00",
  });

  expect((await counts(fixture.organization.id)).lines).toBe(linesBeforeApply);

  const afterApply = await api.party.openItems({
    ...claim,
    partyId: priya.id,
    side: "receivable",
    limit: 25,
  });

  expect(afterApply.rows[0]!.outstandingPaise).toBe(800000n);

  const method = required(fixture.methods[0], "payment method");

  const receipt = await api.receipt.post({
    ...claim,
    settlementKind: "against",
    partyId: priya.id,
    amount: "8000.00",
    paymentMethodId: method.id,
    documentDate: "2026-04-02",
    allocations: [{ documentId: inv88.id, amount: "8000.00" }],
  });

  const payment = await api.payment.post({
    ...claim,
    settlementKind: "against",
    exposureSide: "payable",
    partyId: mehta.id,
    amount: "5000.00",
    paymentMethodId: method.id,
    documentDate: "2026-04-02",
    allocations: [{ documentId: b17.id, amount: "5000.00" }],
  });

  const opening = required(await api.openingBalance.get(claim), "opening balance");
  // Two pages of two: the keyset continues after the first page's last item.
  const firstPage = await api.openingBalance.items({ ...claim, limit: 2 });

  const secondPage = await api.openingBalance.items({
    ...claim,
    limit: 2,
    cursor: firstPage.rows.at(-1)!.id,
  });

  expect(firstPage.hasMore).toBe(true);
  expect(secondPage.hasMore).toBe(false);
  expect(
    [...firstPage.rows, ...secondPage.rows].map((item) => [item.reference, item.balancePaise]),
  ).toEqual([
    ["INV-88", 0n],
    ["ADV-3", 0n],
    ["B-17", 0n],
  ]);

  await expectORPCCode(
    api.openingBalance.cancel({ ...claim, openingBalanceId: opening.id, reason: "Redo cutover" }),
    "CONFLICT",
  );

  await api.receipt.cancel({ ...claim, receiptId: receipt.id, reason: "Test" });
  await api.payment.cancel({ ...claim, paymentId: payment.id, reason: "Test" });
  await api.allocation.reverse({
    ...claim,
    allocationId: required(applied, "apply").id,
    reason: "Test",
  });

  await api.openingBalance.cancel({
    ...claim,
    openingBalanceId: opening.id,
    reason: "Redo cutover",
  });

  for (const [account] of sheet)
    expect(await accountBalance(fixture.organization.id, account.id)).toBe(0n);

  const balances = await api.party.balances(claim);
  expect(balances.every((row) => row.balancePaise === 0n)).toBe(true);

  // A second commit while an Opening Balance is posted is refused.
  await api.import.commit({ ...claim, file });
  await expectORPCCode(api.import.commit({ ...claim, file }), "CONFLICT");
});

test("import checks without writes and creates masters with their opening balances", async () => {
  const fixture = await createAccountingFixture(founder, "import-masters", {
    legalType: "proprietorship",
  });

  const { api } = fixture;
  const claim = { orgSlug: fixture.organization.slug };
  await api.party.create({ ...claim, name: "Mehta Traders", roles: ["vendor"], stateCode: "27" });

  const before = await counts(fixture.organization.id);
  const template = await api.import.template(claim);
  const empty = await api.import.check({ ...claim, file: template });
  expect(empty.errorCount).toBe(0);

  // A full Opening items sheet: each new Party holds a ₹1 claim. The double space
  // collapses when the Party is saved; its items still post against it.
  const file = await workbook(
    [
      ["Cash in Hand", 20000, null],
      ["1300", 12997, null],
      ["2000", null, 5000],
      ["Capital Account", null, 27997],
    ],
    {
      ...masterRows,
      parties: [
        ...masterRows.parties,
        ...Array.from({ length: 4_999 }, (_, i) => [`Party  ${i}`, "customer", null, null, "27"]),
      ],
      items: [
        ...masterRows.items,
        ...Array.from({ length: 4_999 }, (_, i) => [`Item ${i}`, "Tuition Fees", 0]),
      ],
      openingItems: Array.from({ length: 4_997 }, (_, i) => [
        `Party  ${i}`,
        "Receivable",
        "Claim",
        `P-${i}`,
        "2026-03-01",
        null,
        1,
      ]),
    },
  );

  const checked = await api.import.check({ ...claim, file });
  expect(checked.errorCount).toBe(0);
  expect(checked.summary).toMatchObject({
    accounts: 1,
    parties: 5_000,
    items: 5_000,
    openingClaims: 4_999,
  });
  expect(await counts(fixture.organization.id)).toEqual(before);

  const queries = spyOn(pg.Client.prototype, "query");

  try {
    await api.import.commit({ ...claim, file });
    expect(queries.mock.calls.length).toBeLessThan(60);
  } finally {
    queries.mockRestore();
  }

  const after = await counts(fixture.organization.id);
  expect(after.parties - before.parties).toBe(5_000);
  expect(after.items - before.items).toBe(5_000);

  const [last] = await db
    .select({ number: documents.number, partyName: parties.name })
    .from(documents)
    .innerJoin(parties, eq(parties.id, documents.partyId))
    .where(and(eq(documents.orgId, fixture.organization.id), eq(documents.reference, "P-4996")));

  expect(last).toEqual({ number: "OC25-26/4999", partyName: "Party 4996" });

  const [[income], [priya], [tuition]] = await Promise.all([
    db
      .select()
      .from(accounts)
      .where(and(eq(accounts.orgId, fixture.organization.id), eq(accounts.name, "Tuition Fees"))),
    db
      .select()
      .from(parties)
      .where(and(eq(parties.orgId, fixture.organization.id), eq(parties.name, "Priya"))),
    db
      .select()
      .from(items)
      .where(and(eq(items.orgId, fixture.organization.id), eq(items.name, "Tuition"))),
  ]);

  const incomeAccount = required(income, "Tuition Fees");
  expect(incomeAccount).toMatchObject({ type: "income", supplyClass: "exempt" });
  expect(required(tuition, "Tuition").incomeAccountId).toBe(incomeAccount.id);

  const statement = await api.party.statement({
    ...claim,
    partyId: required(priya, "Priya").id,
  });

  expect(statement.closingPaise).toBe(800000n);
});

test("import reports master errors by cell and rejects the whole workbook without writes", async () => {
  const fixture = await createAccountingFixture(founder, "import-master-errors", {
    legalType: "proprietorship",
  });

  const { api } = fixture;
  const claim = { orgSlug: fixture.organization.slug };

  const [, mehta] = await Promise.all([
    api.party.create({ ...claim, name: "Priya", roles: ["customer"], stateCode: "27" }),
    api.party.create({ ...claim, name: "Mehta Traders", roles: ["vendor"], stateCode: "27" }),
  ]);

  await api.party.update({
    ...claim,
    partyId: mehta.id,
    name: mehta.name,
    roles: mehta.roles,
    stateCode: mehta.stateCode,
    active: false,
    updatedAt: mehta.updatedAt.toISOString(),
  });

  const before = await counts(fixture.organization.id);

  const file = await workbook(cutoverTrialBalance, {
    ...masterRows,
    items: [["Tuition", "Nonexistent", 0]],
  });

  const checked = await api.import.check({ ...claim, file });
  expect(checked.errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        sheet: "Parties",
        row: 2,
        column: "Name",
        code: "PARTY_NAME_COLLISION",
      }),
      expect.objectContaining({
        sheet: "Items",
        row: 2,
        column: "Income account",
        code: "ACCOUNT_UNKNOWN",
      }),
      expect.objectContaining({
        sheet: "Opening items",
        row: 4,
        column: "Party",
        code: "PARTY_INACTIVE",
      }),
    ]),
  );
  expect(await counts(fixture.organization.id)).toEqual(before);

  const refused = await expectORPCCode(api.import.commit({ ...claim, file }), "BAD_REQUEST");
  expect(refused.data).toMatchObject({ reason: "IMPORT_INVALID" });
  expect(await counts(fixture.organization.id)).toEqual(before);

  // Cells below blank headers, including far-away columns, must not disappear or
  // allocate their bounding rectangle. Valid masters in this file must roll back.
  const unheadedRows: Cell[][] = [["Account", "Debit", "Credit", null]];

  for (let row = 0; row < 100; row++) {
    const cells: Cell[] = [];
    cells[3] = "Cash in Hand";
    cells[16_383] = "100";
    unheadedRows.push(cells);
  }

  const unheadedBytes = await writeXlsx({
    sheets: [
      { name: "Read me", rows: [["Template version", "1"]] },
      {
        name: "Accounts",
        rows: [
          ["Name", "Parent"],
          ["Must not be created", "Assets"],
        ],
      },
      { name: "Trial balance", rows: unheadedRows },
    ],
  });

  const unheadedFile = new File([new Uint8Array(unheadedBytes)], "unheaded.xlsx");
  const unheadedCheck = await api.import.check({ ...claim, file: unheadedFile });

  expect(unheadedCheck.errorCount).toBe(200);
  expect(unheadedCheck.errors[0]).toMatchObject({
    sheet: "Trial balance",
    row: 2,
    column: "4",
    code: "HEADER_MISSING",
  });
  await expectORPCCode(api.import.commit({ ...claim, file: unheadedFile }), "BAD_REQUEST");
  expect(await counts(fixture.organization.id)).toEqual(before);

  const duplicate = await openXlsx(
    await writeXlsx({
      sheets: [
        { name: "Read me", rows: [["Instructions", "1"]] },
        {
          name: "Accounts",
          rows: [
            ["Name", "Parent"],
            ["First", "Assets"],
          ],
        },
        {
          name: "Other",
          rows: [
            ["Name", "Parent"],
            ["Second", "Assets"],
          ],
        },
      ],
    }),
  );

  required(duplicate.sheets[2], "duplicate sheet").name = "Accounts";
  const duplicateBytes = await saveXlsx(duplicate);
  const duplicateFile = new File([new Uint8Array(duplicateBytes)], "duplicate.xlsx");
  const duplicateCheck = await api.import.check({ ...claim, file: duplicateFile });
  expect(duplicateCheck.errors).toContainEqual(expect.objectContaining({ code: "SHEET_REPEATED" }));
  await expectORPCCode(api.import.commit({ ...claim, file: duplicateFile }), "BAD_REQUEST");
  expect(await counts(fixture.organization.id)).toEqual(before);
});

test("import refuses hidden overflow and posts the full 5,000-line trial balance", async () => {
  const fixture = await createAccountingFixture(founder, "import-limit", {
    legalType: "proprietorship",
  });

  const claim = { orgSlug: fixture.organization.slug };
  const before = await counts(fixture.organization.id);

  const rows: Cell[][] = [
    ["Account", "Debit", "Credit"],
    ["1001", 1, null],
    ["3000", null, 1],
    ...Array.from({ length: 4_999 }, () => []),
    ["1001", 2, null],
    ["3000", null, 2],
  ];

  const sheets = [
    { name: "Read me", rows: [["Template version", "1"]] },
    { name: "Opening", rows: [["Opening date"], ["2026-03-31"]] },
  ];

  const overflow = await writeXlsx({
    sheets: [
      ...sheets,
      {
        name: "Trial balance",
        rows,
        // Excel can keep empty rows with formatting. These count toward maxRows.
        rowDefs: new Map(Array.from({ length: 4_999 }, (_, i) => [i + 3, { height: 20 }])),
      },
    ],
  });

  const overflowFile = new File([new Uint8Array(overflow)], "overflow.xlsx");

  expect(await fixture.api.import.check({ ...claim, file: overflowFile })).toMatchObject({
    errors: [{ code: "SHEET_TOO_LARGE" }],
  });
  await expectORPCCode(fixture.api.import.commit({ ...claim, file: overflowFile }), "BAD_REQUEST");
  expect(await counts(fixture.organization.id)).toEqual(before);

  const full = await writeXlsx({
    sheets: [
      ...sheets,
      {
        name: "Trial balance",
        rows: [
          rows[0]!,
          ...Array.from({ length: 5_000 }, (_, i) =>
            i % 2 === 0 ? ["1001", 1, null] : ["3000", null, 1],
          ),
        ],
      },
    ],
  });

  await fixture.api.import.commit({
    ...claim,
    file: new File([new Uint8Array(full)], "full.xlsx"),
  });
  const opening = required(await fixture.api.openingBalance.get(claim), "opening balance");
  expect(opening.lines).toHaveLength(5_000);
  expect(opening.lines[4_999]!.accountCode).toBe("3000");
  expect(opening.totalPaise).toBe(250_000n);
  await fixture.api.openingBalance.cancel({
    ...claim,
    openingBalanceId: opening.id,
    reason: "Verify reversal",
  });

  const cash = required(
    fixture.accounts.find((account) => account.code === "1001"),
    "cash",
  );

  expect(await accountBalance(fixture.organization.id, cash.id)).toBe(0n);
});
