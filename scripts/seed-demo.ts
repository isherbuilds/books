import { drainAuditWrites } from "@accly/db/audit";
import { createOrganization, createOrganizationInput } from "@accly/api/core/organizations";
import { createRequestContext } from "@accly/api/lib/context";
import { appRouter } from "@accly/api/routers/index";
import { auth } from "@accly/auth";
import { db } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { allocations } from "@accly/db/schema/allocations";
import { organization, user } from "@accly/db/schema/auth";
import { documents, type DocumentType } from "@accly/db/schema/documents";
import { items } from "@accly/db/schema/items";
import { parties } from "@accly/db/schema/parties";
import { paymentMethods } from "@accly/db/schema/payment-methods";
import { tdsSections } from "@accly/db/schema/tds-sections";
import { env } from "@accly/env/server";
import { createRouterClient } from "@orpc/server";
import { and, eq, isNull } from "drizzle-orm";

// Small, named workflows complement seed.ts's receipt history. All writes use the
// application's procedures; the database reads only find existing demo markers.
const SLUG = "cedar-components";

const PASSWORD = "password123";

const MARK = "DEMO-CEDAR";

const BASE_DATE = new Date();

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Demo seed is missing ${label}`);

  return value;
}

function daysFromToday(days: number): string {
  const date = new Date(BASE_DATE);
  date.setUTCDate(date.getUTCDate() + days);

  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

async function existingDocument(
  orgId: string,
  type: DocumentType,
  reference: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(eq(documents.orgId, orgId), eq(documents.type, type), eq(documents.reference, reference)),
    )
    .limit(1);

  return row?.id;
}

async function ensureDocument(
  orgId: string,
  type: DocumentType,
  reference: string,
  post: () => Promise<{ id: string }>,
): Promise<string> {
  return (await existingDocument(orgId, type, reference)) ?? (await post()).id;
}

async function ensureNote(
  orgId: string,
  type: "creditNote" | "debitNote",
  sourceId: string,
  narration: string,
  post: () => Promise<{ id: string }>,
): Promise<string> {
  const [row] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.orgId, orgId),
        eq(documents.type, type),
        eq(documents.againstDocumentId, sourceId),
        eq(documents.narration, narration),
      ),
    )
    .limit(1);

  return row?.id ?? (await post()).id;
}

export async function seedDemo(): Promise<void> {
  if (env.NODE_ENV === "production") throw new Error("Refusing to seed a production database.");

  const [owner] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, "owner@example.com"));

  if (!owner) throw new Error("Run bun run db:seed before db:seed:demo.");

  let [org] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, SLUG));

  if (!org) {
    org = await createOrganization(
      owner.id,
      createOrganizationInput.parse({
        name: "Cedar Components",
        slug: SLUG,
        legalType: "company",
        legalName: "Cedar Components Pvt. Ltd.",
        gstin: "27ABCDE1234F1Z0",
        financialYearStart: 4,
        timeZone: "Asia/Kolkata",
        address: "18 Industrial Estate",
        city: "Pune",
        pinCode: "411019",
      }),
    );
  }

  const { headers } = await auth.api.signInEmail({
    body: { email: "owner@example.com", password: PASSWORD },
    returnHeaders: true,
  });

  const cookie = headers.get("set-cookie")?.split(";")[0];

  if (!cookie) throw new Error("Demo owner sign-in returned no session cookie");

  const api = createRouterClient(appRouter, {
    context: () => createRequestContext(new Headers({ cookie })),
  });

  const claim = { orgSlug: SLUG };
  const orgId = org.id;

  const accountRows = await db.select().from(accounts).where(eq(accounts.orgId, orgId));

  const account = (code: string) =>
    required(
      accountRows.find((row) => row.code === code),
      `account ${code}`,
    );

  const sales = account("5010");
  const service = account("5020");
  const purchases = account("6010");
  const administration = account("6030");
  const interest = account("5030");
  const bank = account("1101");
  const cash = account("1001");

  const equity = required(
    accountRows.find((row) => row.systemKey === "openingEquity"),
    "opening equity",
  );

  const methods = await db.select().from(paymentMethods).where(eq(paymentMethods.orgId, orgId));

  const bankMethod = required(
    methods.find((row) => row.name === "Bank transfer"),
    "bank method",
  );

  const cashMethod = required(
    methods.find((row) => row.name === "Cash"),
    "cash method",
  );

  async function party(fields: Parameters<typeof api.party.create>[0]) {
    const [row] = await db
      .select({ id: parties.id })
      .from(parties)
      .where(and(eq(parties.orgId, orgId), eq(parties.name, fields.name)));

    return row ?? api.party.create(fields);
  }

  async function item(fields: Parameters<typeof api.item.create>[0]) {
    const [row] = await db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.orgId, orgId), eq(items.name, fields.name)));

    return row ?? api.item.create(fields);
  }

  const puneBuyer = await party({
    ...claim,
    name: "Kaveri Engineering Works",
    roles: ["customer"],
    stateCode: "27",
    pan: "AABFK1234L",
    address: "4 MIDC Road",
    city: "Pune",
    pinCode: "411026",
  });

  const interstateBuyer = await party({
    ...claim,
    name: "Northstar Machinery",
    roles: ["customer"],
    stateCode: "29",
    address: "30 Peenya Industrial Area",
    city: "Bengaluru",
    pinCode: "560058",
  });

  const supplier = await party({
    ...claim,
    name: "Sahyadri Metals LLP",
    roles: ["vendor"],
    stateCode: "27",
    pan: "AABFS1234K",
    address: "6 Foundry Lane",
    city: "Pune",
    pinCode: "411019",
  });

  const freight = await party({
    ...claim,
    name: "Blue Route Logistics",
    roles: ["vendor"],
    stateCode: "29",
    address: "14 Ring Road",
    city: "Bengaluru",
    pinCode: "560022",
  });

  const dual = await party({
    ...claim,
    name: "Orion Fabrication",
    roles: ["customer", "vendor"],
    stateCode: "27",
    address: "21 Workshop Street",
    city: "Pune",
    pinCode: "411018",
  });

  const registeredBuyer = await party({
    ...claim,
    name: "Vidarbha Controls Pvt. Ltd.",
    roles: ["customer"],
    gstin: "27AABCV1234F1ZO",
    address: "9 Electronics Park",
    city: "Nagpur",
    pinCode: "440016",
  });

  const motor = await item({
    ...claim,
    name: "Cedar 2 HP motor",
    hsnSac: "8501",
    unit: "piece",
    unitPrice: "12500.00",
    mrp: "14999.00",
    incomeAccountId: sales.id,
    taxCode: "GST18",
  });

  const bracket = await item({
    ...claim,
    name: "Mounting bracket",
    hsnSac: "7326",
    unit: "piece",
    unitPrice: "800.00",
    incomeAccountId: sales.id,
    taxCode: "GST18",
  });

  const installation = await item({
    ...claim,
    name: "On-site installation",
    hsnSac: "9983",
    unit: "service",
    unitPrice: "2500.00",
    incomeAccountId: service.id,
    taxCode: "GST18",
  });

  if (!(await api.openingBalance.get(claim))) {
    await api.openingBalance.post({
      ...claim,
      // seed.ts's receipt history reaches at most 182 days back.
      documentDate: daysFromToday(-183),
      lines: [
        { accountId: bank.id, side: "debit", amount: "250000.00" },
        { accountId: cash.id, side: "debit", amount: "10000.00" },
        { accountId: equity.id, side: "credit", amount: "260000.00" },
      ],
    });
  }

  const draftRef = `${MARK}-DRAFT`;

  if (!(await existingDocument(orgId, "invoice", draftRef))) {
    await api.invoice.saveDraft({
      ...claim,
      partyId: dual.id,
      placeOfSupplyStateCode: "27",
      documentDate: daysFromToday(0),
      dueDate: daysFromToday(20),
      reference: draftRef,
      narration: "Quote awaiting purchase order",
      lines: [{ kind: "item", itemId: motor.id, quantity: 2 }],
    });
  }

  if (!(await existingDocument(orgId, "bill", `${MARK}-BILL-DRAFT`))) {
    await api.bill.saveDraft({
      ...claim,
      partyId: supplier.id,
      documentDate: daysFromToday(0),
      reference: `${MARK}-BILL-DRAFT`,
      narration: "Supplier invoice awaiting approval",
      lines: [
        {
          accountId: purchases.id,
          description: "Replacement housings",
          amount: "4000.00",
          itcEligible: false,
        },
      ],
    });
  }

  const localInvoice = await ensureDocument(orgId, "invoice", `${MARK}-LOCAL`, () =>
    api.invoice.post({
      ...claim,
      partyId: puneBuyer.id,
      placeOfSupplyStateCode: "27",
      documentDate: daysFromToday(-45),
      dueDate: daysFromToday(-15),
      reference: `${MARK}-LOCAL`,
      discountPercent: "5",
      narration: "Two motors and installation, part payment pending",
      lines: [
        { kind: "item", itemId: motor.id, quantity: 2 },
        { kind: "item", itemId: installation.id, quantity: 1 },
      ],
    }),
  );

  const interstateInvoice = await ensureDocument(orgId, "invoice", `${MARK}-INTERSTATE`, () =>
    api.invoice.post({
      ...claim,
      partyId: interstateBuyer.id,
      placeOfSupplyStateCode: "29",
      documentDate: daysFromToday(-8),
      dueDate: daysFromToday(22),
      reference: `${MARK}-INTERSTATE`,
      shipTo: { address: "12 Assembly Park, Mysuru", stateCode: "29" },
      narration: "Interstate supply with a different ship-to address",
      lines: [
        { kind: "item", itemId: motor.id, quantity: 1 },
        { kind: "item", itemId: bracket.id, quantity: 4 },
      ],
    }),
  );

  await ensureDocument(orgId, "invoice", `${MARK}-B2B`, () =>
    api.invoice.post({
      ...claim,
      partyId: registeredBuyer.id,
      placeOfSupplyStateCode: "27",
      documentDate: daysFromToday(-6),
      dueDate: daysFromToday(24),
      reference: `${MARK}-B2B`,
      narration: "GST-registered buyer, payment due next month",
      lines: [{ kind: "item", itemId: motor.id, quantity: 1 }],
    }),
  );
  await ensureDocument(orgId, "invoice", `${MARK}-COUNTER`, () =>
    api.invoice.post({
      ...claim,
      partyId: dual.id,
      placeOfSupplyStateCode: "27",
      documentDate: daysFromToday(-5),
      reference: `${MARK}-COUNTER`,
      narration: "Counter sale paid with cash and bank transfer",
      lines: [{ kind: "item", itemId: bracket.id, quantity: 2 }],
      settle: {
        payments: [
          { paymentMethodId: cashMethod.id, amount: "500.00" },
          { paymentMethodId: bankMethod.id, amount: "1388.00" },
        ],
      },
    }),
  );

  const localDetail = await api.invoice.get({ ...claim, invoiceId: localInvoice });
  await ensureNote(orgId, "creditNote", localInvoice, `${MARK}: one motor returned`, () =>
    api.note.post({
      ...claim,
      type: "creditNote",
      againstDocumentId: localInvoice,
      documentDate: daysFromToday(-3),
      narration: `${MARK}: one motor returned`,
      lines: [
        {
          sourceLineId: required(localDetail.lines[0], "motor invoice line").id,
          amount: "5000.00",
        },
      ],
    }),
  );
  await ensureDocument(orgId, "receipt", `${MARK}-COLLECTION`, () =>
    api.receipt.post({
      ...claim,
      settlementKind: "against",
      exposureSide: "receivable",
      partyId: puneBuyer.id,
      paymentMethodId: bankMethod.id,
      documentDate: daysFromToday(-2),
      reference: `${MARK}-COLLECTION`,
      amount: "10000.00",
      allocations: [{ documentId: localInvoice, amount: "10000.00" }],
    }),
  );
  await ensureDocument(orgId, "receipt", `${MARK}-INTEREST`, () =>
    api.receipt.post({
      ...claim,
      settlementKind: "direct",
      paymentMethodId: bankMethod.id,
      incomeAccountId: interest.id,
      documentDate: daysFromToday(0),
      reference: `${MARK}-INTEREST`,
      amount: "142.37",
      narration: "Monthly bank interest",
    }),
  );

  const duplicateReceipt = await ensureDocument(orgId, "receipt", `${MARK}-DUPLICATE`, () =>
    api.receipt.post({
      ...claim,
      settlementKind: "direct",
      paymentMethodId: bankMethod.id,
      incomeAccountId: interest.id,
      documentDate: daysFromToday(0),
      reference: `${MARK}-DUPLICATE`,
      amount: "142.37",
      narration: "Bank feed imported twice",
    }),
  );

  const [duplicateState] = await db
    .select({ state: documents.state })
    .from(documents)
    .where(and(eq(documents.orgId, orgId), eq(documents.id, duplicateReceipt)));

  if (duplicateState?.state === "posted") {
    await api.receipt.cancel({
      ...claim,
      receiptId: duplicateReceipt,
      reason: "Duplicate bank feed entry",
    });
  }

  const advance = await ensureDocument(orgId, "receipt", `${MARK}-ADVANCE`, () =>
    api.receipt.post({
      ...claim,
      settlementKind: "advance",
      partyId: interstateBuyer.id,
      advanceSupply: "goods",
      paymentMethodId: bankMethod.id,
      documentDate: daysFromToday(-7),
      reference: `${MARK}-ADVANCE`,
      amount: "5000.00",
      narration: "Advance for interstate motor order",
    }),
  );

  const [appliedAdvance] = await db
    .select({ id: allocations.id })
    .from(allocations)
    .where(
      and(
        eq(allocations.orgId, orgId),
        eq(allocations.sourceDocumentId, advance),
        eq(allocations.targetDocumentId, interstateInvoice),
        eq(allocations.kind, "apply"),
      ),
    );

  if (!appliedAdvance) {
    await api.allocation.apply({
      ...claim,
      sourceDocumentId: advance,
      targetDocumentId: interstateInvoice,
      amount: "3000.00",
    });
  }

  const materialsBill = await ensureDocument(orgId, "bill", `${MARK}-MATERIALS`, () =>
    api.bill.post({
      ...claim,
      partyId: supplier.id,
      documentDate: daysFromToday(-20),
      dueDate: daysFromToday(-5),
      reference: `${MARK}-MATERIALS`,
      narration: "Raw material and workshop supplies",
      lines: [
        {
          accountId: purchases.id,
          description: "Motor housings",
          amount: "30000.00",
          taxCode: "GST18",
          itcEligible: true,
        },
        {
          accountId: purchases.id,
          description: "Staff refreshments",
          amount: "1000.00",
          taxCode: "GST18",
          itcEligible: false,
        },
      ],
    }),
  );

  await ensureDocument(orgId, "bill", `${MARK}-FREIGHT`, () =>
    api.bill.post({
      ...claim,
      partyId: freight.id,
      documentDate: daysFromToday(-4),
      dueDate: daysFromToday(26),
      reference: `${MARK}-FREIGHT`,
      narration: "Interstate freight service",
      lines: [
        {
          accountId: purchases.id,
          description: "Outbound freight",
          amount: "12000.00",
          taxCode: "GST18",
          itcEligible: true,
        },
      ],
    }),
  );

  const [contractorSection] = await db
    .select({ id: tdsSections.id })
    .from(tdsSections)
    .where(
      and(
        eq(tdsSections.orgId, orgId),
        eq(tdsSections.code, "1024"),
        isNull(tdsSections.effectiveTo),
      ),
    );

  await ensureDocument(orgId, "bill", `${MARK}-MAINTENANCE`, () =>
    api.bill.post({
      ...claim,
      partyId: supplier.id,
      tdsSectionId: required(contractorSection, "current contractor TDS section").id,
      documentDate: daysFromToday(-2),
      dueDate: daysFromToday(28),
      reference: `${MARK}-MAINTENANCE`,
      narration: "Workshop maintenance contract with TDS",
      lines: [
        {
          accountId: administration.id,
          description: "Machine maintenance",
          amount: "5000.00",
          taxCode: "GST18",
          itcEligible: true,
        },
      ],
    }),
  );
  const billDetail = await api.bill.get({ ...claim, billId: materialsBill });
  await ensureNote(orgId, "debitNote", materialsBill, `${MARK}: damaged housing returned`, () =>
    api.note.post({
      ...claim,
      type: "debitNote",
      againstDocumentId: materialsBill,
      documentDate: daysFromToday(-1),
      narration: `${MARK}: damaged housing returned`,
      lines: [
        { sourceLineId: required(billDetail.lines[0], "housing bill line").id, amount: "2000.00" },
      ],
    }),
  );
  await ensureDocument(orgId, "payment", `${MARK}-SUPPLIER-PAY`, () =>
    api.payment.post({
      ...claim,
      settlementKind: "against",
      exposureSide: "payable",
      partyId: supplier.id,
      paymentMethodId: bankMethod.id,
      documentDate: daysFromToday(0),
      reference: `${MARK}-SUPPLIER-PAY`,
      amount: "10000.00",
      allocations: [{ documentId: materialsBill, amount: "10000.00" }],
    }),
  );
  await ensureDocument(orgId, "payment", `${MARK}-SUPPLIER-ADVANCE`, () =>
    api.payment.post({
      ...claim,
      settlementKind: "advance",
      partyId: freight.id,
      paymentMethodId: bankMethod.id,
      documentDate: daysFromToday(0),
      reference: `${MARK}-SUPPLIER-ADVANCE`,
      amount: "2500.00",
      narration: "Deposit against next freight run",
    }),
  );
  await ensureDocument(orgId, "payment", `${MARK}-COURIER`, () =>
    api.payment.post({
      ...claim,
      settlementKind: "direct",
      partyId: freight.id,
      expenseAccountId: administration.id,
      paymentMethodId: cashMethod.id,
      documentDate: daysFromToday(0),
      reference: `${MARK}-COURIER`,
      amount: "750.00",
      narration: "Local courier charges paid from petty cash",
    }),
  );
  await ensureDocument(orgId, "journal", `${MARK}-CASH-DEPOSIT`, () =>
    api.journal.post({
      ...claim,
      documentDate: daysFromToday(-1),
      reference: `${MARK}-CASH-DEPOSIT`,
      narration: "Deposit counter cash into the current account",
      lines: [
        { accountId: bank.id, side: "debit", amount: "3000.00" },
        { accountId: cash.id, side: "credit", amount: "3000.00" },
      ],
    }),
  );

  console.info(
    `Demo ready: ${SLUG}; 6 parties, 3 items, draft and posted invoices and bills, ` +
      `receipts, payments, notes, opening balance and journal. ` +
      `Open ${env.CORS_ORIGIN}/${SLUG}.`,
  );
}

if (import.meta.main) {
  await seedDemo();
  await drainAuditWrites();
  process.exit(0);
}
