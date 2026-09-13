import { postDocument, reverseDocument } from "@accly/api/core/documents";
import { financialYearOf } from "@accly/api/core/numbering";
import { createOrganization, createOrganizationInput } from "@accly/api/core/organizations";
import type { ReceiptPosting } from "@accly/api/core/posting";
import { normalizedPartyName } from "@accly/api/routers/party";
import { businessDate } from "@accly/api/lib/business-date";
import type { Scope } from "@accly/api/lib/procedures/factory";
import { auth } from "@accly/auth";
import type { RoleKey } from "@accly/auth/access";
import { createUserWithPassword } from "@accly/auth/manual-user";
import { db } from "@accly/db";
import { runMigrations } from "@accly/db/migrate";
import { accounts } from "@accly/db/schema/accounts";
import { member, organization, user } from "@accly/db/schema/auth";
import type { PrintSnapshot } from "@accly/db/schema/documents";
import { organizationSettings } from "@accly/db/schema/organization-settings";
import { parties, type PartyRole } from "@accly/db/schema/parties";
import { paymentMethods } from "@accly/db/schema/payment-methods";
import { env } from "@accly/env/server";
import { and, asc, count, eq } from "drizzle-orm";
import pg from "pg";

// bun run db:seed, or `-- --reset` to drop the schema first. Refuses to touch a
// production database. Every account is created with `createUserWithPassword`,
// exactly as an operator would, because sign-up is disabled.
//
// Each organization then gets parties and receipts. Masters are inserted directly;
// every receipt and cancellation goes through postDocument/reverseDocument, the
// same core the receipt router calls, so ledgers, balances and numbers agree.
// A fixed PRNG seed makes reruns produce the same data for the same date.

const PASSWORD = "password123";

const FIXED_SEED = 0x5eed_2026;

const DAY_MS = 86_400_000;

const POST_BATCH = 250;

type Person = {
  email: string;
  name: string;
  id: string;
  headers: Headers;
};

type Party = typeof parties.$inferSelect;

type Account = typeof accounts.$inferSelect;

type PaymentMethod = typeof paymentMethods.$inferSelect;

type Settings = typeof organizationSettings.$inferSelect;

// --- Organization profiles ----------------------------------------------------

type PartyKind = "business" | "person";

type Flow = {
  weight: number;
  // Income account name for a direct receipt; null is an advance.
  account: string | null;
  // Which parties pay this flow; null is a receipt without a party.
  roles: PartyRole[] | null;
  rupees: [min: number, max: number, step: number];
  withPaise?: true;
  method?: string;
  narrations: ReadonlyArray<string | null>;
};

export type OrgProfile = {
  organization: Parameters<typeof createOrganization>[1];
  parties: Array<{ count: number; roles: PartyRole[]; kind: PartyKind }>;
  publicBodies: string[];
  receiptsPerDay: [min: number, max: number];
  flows: Flow[];
  // Posted on the 28th of each month, such as bank interest.
  monthly: Flow[];
};

const bankInterest: Flow = {
  weight: 1,
  account: "Interest Income",
  roles: null,
  rupees: [800, 6_000, 1],
  withPaise: true,
  method: "Bank transfer",
  narrations: ["Savings account interest", "Interest on fixed deposit"],
};

export const ORGS: OrgProfile[] = [
  {
    organization: {
      name: "Meridian Traders",
      slug: "meridian-traders",
      legalType: "company",
      legalName: "Meridian Traders Pvt. Ltd.",
      pan: "AAACM1234A",
      stateCode: "27",
      financialYearStart: 4,
      timeZone: "Asia/Kolkata",
      addressLine1: "12 Business Road",
      city: "Pune",
      pinCode: "411001",
    },
    parties: [
      { count: 50, roles: ["customer"], kind: "business" },
      { count: 14, roles: ["customer"], kind: "person" },
      { count: 16, roles: ["vendor"], kind: "business" },
      { count: 6, roles: ["customer", "vendor"], kind: "business" },
      { count: 6, roles: ["employee"], kind: "person" },
    ],
    publicBodies: ["Maharashtra Industrial Development Corporation", "Pune Municipal Corporation"],
    receiptsPerDay: [1, 6],
    flows: [
      {
        weight: 50,
        account: null,
        roles: ["customer"],
        rupees: [5_000, 200_000, 500],
        narrations: [null, "Advance against order", "Advance for next dispatch", "Booking advance"],
      },
      {
        weight: 25,
        account: "Sales",
        roles: ["customer"],
        rupees: [1_500, 90_000, 50],
        narrations: [null, "Counter sale", "Goods sold on cash terms"],
      },
      {
        weight: 15,
        account: "Service Income",
        roles: ["customer"],
        rupees: [2_000, 40_000, 100],
        narrations: ["Installation charges", "Freight recovered", "Annual maintenance visit"],
      },
      {
        weight: 10,
        account: "Sales",
        roles: null,
        rupees: [300, 8_000, 10],
        narrations: ["Walk-in counter sale"],
      },
    ],
    monthly: [bankInterest],
  },
  {
    organization: {
      name: "Ridgeview Academy",
      slug: "ridgeview-academy",
      legalType: "trust",
      legalName: "Ridgeview Education Trust",
      pan: "AAATR4821K",
      stateCode: "29",
      financialYearStart: 4,
      timeZone: "Asia/Kolkata",
      addressLine1: "4 Lake View Road, Jayanagar",
      city: "Bengaluru",
      pinCode: "560041",
    },
    parties: [
      { count: 44, roles: ["customer"], kind: "person" },
      { count: 10, roles: ["donor"], kind: "person" },
      { count: 4, roles: ["donor"], kind: "business" },
      { count: 8, roles: ["vendor"], kind: "business" },
      { count: 6, roles: ["employee"], kind: "person" },
      { count: 2, roles: ["tenant"], kind: "business" },
    ],
    publicBodies: [
      "Department of School Education, Karnataka",
      "Bruhat Bengaluru Mahanagara Palike",
    ],
    receiptsPerDay: [0, 4],
    flows: [
      {
        weight: 35,
        account: null,
        roles: ["customer"],
        rupees: [15_000, 75_000, 500],
        narrations: [null, "Term fee advance", "Advance for annual fees", "Transport fee advance"],
      },
      {
        weight: 40,
        account: "Fees",
        roles: ["customer"],
        rupees: [3_000, 45_000, 100],
        narrations: ["Tuition fee", "Examination fee", "Transport fee", "Admission fee"],
      },
      {
        weight: 15,
        account: "Donations",
        roles: ["donor"],
        rupees: [1_000, 100_000, 500],
        narrations: [null, "Library fund donation", "Scholarship fund", "Annual day sponsorship"],
      },
      {
        weight: 9,
        account: "Fees",
        roles: null,
        rupees: [200, 3_500, 50],
        narrations: ["Late fee", "Certificate fee", "Duplicate ID card"],
      },
      {
        weight: 1,
        account: "Grants",
        roles: ["government"],
        rupees: [100_000, 500_000, 1_000],
        method: "Bank transfer",
        narrations: ["Grant-in-aid instalment"],
      },
    ],
    monthly: [bankInterest],
  },
];

// --- Deterministic randomness and dates ---------------------------------------

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b_79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const pick = <T>(random: () => number, items: readonly T[]): T =>
  items[Math.floor(random() * items.length)]!;

const between = (random: () => number, min: number, max: number) =>
  min + Math.floor(random() * (max - min + 1));

const digits = (random: () => number, length: number) =>
  Array.from({ length }, () => between(random, 0, 9)).join("");

const letters = (random: () => number, length: number) =>
  Array.from({ length }, () => String.fromCharCode(65 + between(random, 0, 25))).join("");

export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

// --- Parties -------------------------------------------------------------------

const GIVEN =
  "Aarav,Aditi,Amit,Ananya,Arjun,Deepa,Farhan,Fatima,Gaurav,Harish,Imran,Ishita,Joseph,Kavya,Kiran,Lakshmi,Manoj,Meera,Mohan,Neha,Nikhil,Pooja,Prakash,Priya,Rahul,Rekha,Rohan,Sanjay,Shalini,Sneha,Suresh,Tanvi,Varun,Vikram,Yusuf,Zoya".split(
    ",",
  );

const FAMILY =
  "Agarwal,Banerjee,Bhosale,Chatterjee,D'Souza,Deshpande,Fernandes,Gaikwad,Gowda,Iyer,Jain,Joshi,Kamath,Kulkarni,Menon,Mehta,Nair,Patil,Pillai,Qureshi,Rao,Reddy,Shah,Sharma,Sheikh,Shetty,Singh,Verma,Yadav".split(
    ",",
  );

const BUSINESS_STEMS =
  "Annapurna,Apex,Balaji,Bluestone,Deccan,Everest,Ganesh,Greenfield,Gurukrupa,Kaveri,Konkan,Lotus,Mahalaxmi,Narmada,Navkar,Pioneer,Rajhans,Sahyadri,Sai Krupa,Shubh Labh,Silverline,Sunrise,Tirupati,Unity,Vardhman".split(
    ",",
  );

const BUSINESS_TRADES =
  "Traders,Enterprises,Distributors,Agencies,Industries,Stores,Logistics,Packaging,Electricals,Hardware,Textiles,Foods,Pharma,Steel".split(
    ",",
  );

// The PAN's fourth letter is the holder type: C company, F firm, P individual.
const BUSINESS_FORMS = [
  { suffix: "Pvt. Ltd.", panType: "C" },
  { suffix: "Pvt. Ltd.", panType: "C" },
  { suffix: "LLP", panType: "F" },
  { suffix: "& Co.", panType: "F" },
  { suffix: "", panType: "P" },
] as const;

const STREETS =
  "Station Road,MG Road,Market Yard,Industrial Estate Phase 2,Link Road,Ring Road,Nehru Nagar,Shivaji Nagar,Gandhi Chowk,Civil Lines".split(
    ",",
  );

const LOCATIONS = [
  { stateCode: "27", city: "Pune", pin: "411" },
  { stateCode: "27", city: "Mumbai", pin: "400" },
  { stateCode: "27", city: "Nashik", pin: "422" },
  { stateCode: "29", city: "Bengaluru", pin: "560" },
  { stateCode: "29", city: "Mysuru", pin: "570" },
  { stateCode: "24", city: "Ahmedabad", pin: "380" },
  { stateCode: "33", city: "Chennai", pin: "600" },
  { stateCode: "07", city: "New Delhi", pin: "110" },
  { stateCode: "36", city: "Hyderabad", pin: "500" },
  { stateCode: "09", city: "Lucknow", pin: "226" },
  { stateCode: "19", city: "Kolkata", pin: "700" },
];

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// State code + PAN + entity number + Z + the GSTN mod-36 check character.
function gstinFor(stateCode: string, pan: string): string {
  const body = `${stateCode}${pan}1Z`;
  let sum = 0;

  for (let index = 0; index < body.length; index += 1) {
    const product = GSTIN_CHARS.indexOf(body[index]!) * (index % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }

  return body + GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

function buildParties(
  orgId: string,
  profile: OrgProfile,
  random: () => number,
): Array<typeof parties.$inferInsert> {
  const names = new Set<string>();
  const pans = new Set<string>();
  const home = LOCATIONS.filter((place) => place.stateCode === profile.organization.stateCode);

  const unique = (set: Set<string>, make: () => string): string => {
    let value = make();

    while (set.has(value)) value = make();
    set.add(value);

    return value;
  };

  const panFor = (panType: string, name: string) =>
    unique(
      pans,
      () => `${letters(random, 3)}${panType}${name[0]}${digits(random, 4)}${letters(random, 1)}`,
    );

  const location = () => pick(random, random() < 0.65 ? home : LOCATIONS);

  const handle = (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z]+/g, ".")
      .replace(/^\.|\.$/g, "");

  const row = (name: string, roles: PartyRole[], fields: Partial<typeof parties.$inferInsert>) => ({
    id: Bun.randomUUIDv7(),
    orgId,
    name,
    normalizedName: normalizedPartyName(name),
    roles,
    stateCode: profile.organization.stateCode,
    active: random() >= 0.06,
    ...fields,
  });

  const business = (roles: PartyRole[]) => {
    const form = pick(random, BUSINESS_FORMS);

    const name = unique(names, () =>
      `${pick(random, BUSINESS_STEMS)} ${pick(random, BUSINESS_TRADES)} ${form.suffix}`.trim(),
    );

    const place = location();
    const roll = random();
    const pan = roll < 0.9 ? panFor(form.panType, name) : null;

    return row(name, roles, {
      stateCode: place.stateCode,
      pan,
      gstin: pan && roll < 0.75 ? gstinFor(place.stateCode, pan) : null,
      addressLine1: `${between(random, 1, 250)}, ${pick(random, STREETS)}`,
      city: place.city,
      pinCode: `${place.pin}${digits(random, 3)}`,
      email:
        random() < 0.7 ? `accounts@${handle(name.replace(form.suffix, ""))}.example.com` : null,
      phone: random() < 0.8 ? `+91 9${digits(random, 9)}` : null,
    });
  };

  const person = (roles: PartyRole[]) => {
    const family = pick(random, FAMILY);
    const name = unique(names, () => `${pick(random, GIVEN)} ${family}`);
    const place = location();
    const withAddress = random() < 0.5;

    return row(name, roles, {
      stateCode: place.stateCode,
      pan: random() < 0.3 ? panFor("P", family) : null,
      addressLine1: withAddress
        ? `Flat ${between(random, 101, 1204)}, ${pick(random, STREETS)}`
        : null,
      city: withAddress ? place.city : null,
      pinCode: withAddress ? `${place.pin}${digits(random, 3)}` : null,
      email: random() < 0.4 ? `${handle(name)}@example.com` : null,
      phone: random() < 0.85 ? `+91 9${digits(random, 9)}` : null,
    });
  };

  return [
    ...profile.parties.flatMap(({ count, roles, kind }) =>
      Array.from({ length: count }, () => (kind === "business" ? business(roles) : person(roles))),
    ),
    ...profile.publicBodies.map((name) =>
      row(name, ["government"], { city: home[0]?.city ?? null, active: true }),
    ),
  ];
}

// --- Receipts through the core posting path -----------------------------------

export type BooksOrg = {
  scope: Scope;
  settings: Settings;
  // Only the income accounts a direct receipt may credit under this org's GST rules.
  incomeAccounts: Map<string, Account>;
  methods: Map<string, PaymentMethod>;
  parties: Party[];
};

export type ReceiptPlan = (
  | { account: null; party: Party }
  | { account: Account; party: Party | null }
) & {
  date: string;
  amountPaise: bigint;
  method: PaymentMethod;
  reference: string | null;
  narration: string | null;
  cancelReason: string | null;
};

const directAllowed = (settings: Settings, account: Account) =>
  account.type === "income" &&
  account.active &&
  !(settings.gstin && account.supplyClass === "taxable");

export async function loadBooksOrg(slug: string): Promise<BooksOrg> {
  const [org] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, slug))
    .limit(1);

  if (!org) throw new Error(`No organization "${slug}". Run \`bun run db:seed\` first.`);

  const [[settings], [owner], accountRows, methodRows, partyRows] = await Promise.all([
    db.select().from(organizationSettings).where(eq(organizationSettings.orgId, org.id)),
    db
      .select({ userId: member.userId })
      .from(member)
      .where(and(eq(member.organizationId, org.id), eq(member.role, "owner")))
      .limit(1),
    db.select().from(accounts).where(eq(accounts.orgId, org.id)),
    db
      .select()
      .from(paymentMethods)
      .where(and(eq(paymentMethods.orgId, org.id), eq(paymentMethods.active, true))),
    db.select().from(parties).where(eq(parties.orgId, org.id)).orderBy(asc(parties.name)),
  ]);

  if (!settings || !owner) throw new Error(`${slug}: missing settings or owner membership`);

  return {
    scope: { userId: owner.userId, orgId: org.id, roles: ["owner"] },
    settings,
    incomeAccounts: new Map(
      accountRows.filter((row) => directAllowed(settings, row)).map((row) => [row.name, row]),
    ),
    methods: new Map(methodRows.map((row) => [row.name, row])),
    parties: partyRows,
  };
}

const CANCEL_REASONS = [
  "Duplicate entry",
  "Cheque returned unpaid",
  "Wrong party selected",
  "Amount entered incorrectly",
  "Payment reversed by bank",
];

const BANK_CODES = ["HDFC", "ICIC", "SBIN", "UTIB", "KKBK"];

function methodFor(rupees: number, random: () => number): string {
  if (rupees >= 50_000) return pick(random, ["Bank transfer", "Bank transfer", "Cheque"]);

  if (rupees >= 10_000) return pick(random, ["UPI", "Bank transfer", "Cheque", "Card"]);

  return pick(random, ["Cash", "Cash", "UPI", "UPI", "Card"]);
}

function referenceFor(method: string, random: () => number): string | null {
  switch (method) {
    case "UPI":
      return `UPI/${digits(random, 12)}`;
    case "Card":
      return `Card xx${digits(random, 4)}, auth ${digits(random, 6)}`;
    case "Bank transfer":
      return `${pick(random, BANK_CODES)}N${digits(random, 12)}`;
    case "Cheque":
      return `Chq ${digits(random, 6)}`;
    default:
      return random() < 0.3 ? `Book ${between(random, 1, 40)}/${digits(random, 3)}` : null;
  }
}

// One day's receipts: `count` weighted flows, plus the monthly flows on the 28th.
export function planReceipts(
  org: BooksOrg,
  profile: OrgProfile,
  random: () => number,
  days: ReadonlyArray<{ date: string; count: number }>,
): ReceiptPlan[] {
  const active = org.parties.filter((party) => party.active);

  const usable = (flow: Flow) => {
    const pool = flow.roles
      ? active.filter((party) => party.roles.some((role) => flow.roles!.includes(role)))
      : null;

    const account = flow.account ? org.incomeAccounts.get(flow.account) : null;

    if (flow.account ? !account : !pool) return [];

    return pool?.length === 0 ? [] : [{ flow, pool, account: account ?? null }];
  };

  const regular = profile.flows
    .flatMap(usable)
    .flatMap((entry) => Array<typeof entry>(entry.flow.weight).fill(entry));

  const monthly = profile.monthly.flatMap(usable);

  const plan = (date: string, { flow, pool, account }: (typeof regular)[number]): ReceiptPlan => {
    const [min, max, step] = flow.rupees;
    const rupees = min + step * Math.floor(random() * ((max - min) / step + 1));
    const methodName = flow.method ?? methodFor(rupees, random);
    const method = org.methods.get(methodName);

    if (!method) throw new Error(`No active payment method "${methodName}"`);

    // Squaring skews toward the first parties, so a few regulars pay most often.
    const party = pool ? pool[Math.floor(random() ** 2 * pool.length)]! : null;

    const common = {
      date,
      amountPaise: BigInt(rupees) * 100n + (flow.withPaise ? BigInt(between(random, 0, 99)) : 0n),
      method,
      reference: referenceFor(methodName, random),
      narration: pick(random, flow.narrations),
      cancelReason: random() < 0.05 ? pick(random, CANCEL_REASONS) : null,
    };

    if (account) return { ...common, account, party };

    if (!party) throw new Error("An advance flow needs a party pool");

    return { ...common, account: null, party };
  };

  if (!regular.length) throw new Error(`${profile.organization.slug}: no usable receipt flow`);

  return days.flatMap(({ date, count }) => [
    ...Array.from({ length: count }, () => plan(date, pick(random, regular))),
    ...(date.endsWith("-28") ? monthly.map((entry) => plan(date, entry)) : []),
  ]);
}

function addressLine(...parts: Array<string | null>): string {
  const [line1, line2, city, pinCode] = parts;

  return [line1, line2, [city, pinCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

export async function postReceipts(org: BooksOrg, plans: readonly ReceiptPlan[]): Promise<void> {
  const { settings } = org;

  const documentSettings = {
    fiscalYearStartMonth: settings.financialYearStart,
    receiptPrefix: settings.receiptPrefix,
    timeZone: settings.timeZone,
  };

  const organizationSnapshot = {
    legalName: settings.legalName,
    address: addressLine(
      settings.addressLine1,
      settings.addressLine2,
      settings.city,
      settings.pinCode,
    ),
    gstin: settings.gstin,
    pan: settings.pan,
  };

  for (let start = 0; start < plans.length; start += POST_BATCH) {
    await db.transaction(async (tx) => {
      for (const plan of plans.slice(start, start + POST_BATCH)) {
        const { party, account } = plan;
        const lineDescription = plan.narration ?? account?.name ?? "Advance received";

        const posting: ReceiptPosting = account
          ? {
              settlementKind: "direct",
              exposureSide: null,
              partyId: party?.id ?? null,
              incomeAccountId: account.id,
              amountPaise: plan.amountPaise,
            }
          : {
              settlementKind: "advance",
              advanceSupply: "exempt",
              exposureSide: "receivable",
              partyId: plan.party.id,
              incomeAccountId: null,
              amountPaise: plan.amountPaise,
            };

        const printSnapshot: PrintSnapshot = {
          organization: organizationSnapshot,
          party: party
            ? {
                name: party.name,
                address: addressLine(
                  party.addressLine1,
                  party.addressLine2,
                  party.city,
                  party.pinCode,
                ),
                gstin: party.gstin,
              }
            : null,
          paymentMethod: plan.method.name,
          lines: [{ description: lineDescription, hsnSac: null, unit: null }],
        };

        const { documentId } = await postDocument(tx, org.scope, documentSettings, {
          documentDate: plan.date,
          paymentMethodId: plan.method.id,
          paymentMethodAccountId: plan.method.accountId,
          reference: plan.reference,
          narration: plan.narration,
          ...posting,
          affectsTax:
            Boolean(settings.gstin) &&
            ["exempt", "nil", "nonGst"].includes(account?.supplyClass ?? ""),
          printSnapshot,
          lineDescription,
        });

        if (plan.cancelReason) {
          await reverseDocument(tx, org.scope, documentSettings, documentId, plan.cancelReason);
        }
      }
    });
  }
}

// Every day from the start of the current financial year (at most six months back)
// to today; Sundays are closed.
function seedDays(
  settings: Settings,
  random: () => number,
  [min, max]: [number, number],
): Array<{ date: string; count: number }> {
  const today = businessDate(new Date(), settings.timeZone);
  const startYear = financialYearOf(today, settings.financialYearStart).slice(0, 4);
  const yearStart = `${startYear}-${String(settings.financialYearStart).padStart(2, "0")}-01`;
  const sixMonthsAgo = shiftDate(today, -182);
  const days: Array<{ date: string; count: number }> = [];

  for (let date = yearStart > sixMonthsAgo ? yearStart : sixMonthsAgo; date <= today;) {
    const sunday = new Date(`${date}T00:00:00Z`).getUTCDay() === 0;
    days.push({ date, count: sunday ? 0 : between(random, min, max) });
    date = shiftDate(date, 1);
  }

  return days;
}

async function seedBooks(orgId: string, profile: OrgProfile, index: number) {
  const random = mulberry32(FIXED_SEED + index);

  const [bank] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), eq(accounts.systemKey, "bank")));

  if (!bank) throw new Error(`${profile.organization.slug}: missing the bank account`);

  // Organization bootstrap seeds Cash, UPI, Card and Bank transfer; cheques clear to the bank.
  await db
    .insert(paymentMethods)
    .values({ id: Bun.randomUUIDv7(), orgId, name: "Cheque", accountId: bank.id });

  await db.insert(parties).values(buildParties(orgId, profile, random));

  const org = await loadBooksOrg(profile.organization.slug);

  const plans = planReceipts(
    org,
    profile,
    random,
    seedDays(org.settings, random, profile.receiptsPerDay),
  );

  await postReceipts(org, plans);

  return {
    parties: org.parties.length,
    inactive: org.parties.filter((party) => !party.active).length,
    receipts: plans.length,
    advances: plans.filter((plan) => plan.account === null).length,
    cancelled: plans.filter((plan) => plan.cancelReason).length,
  };
}

// --- Accounts and organizations ------------------------------------------------

// `NODE_ENV` defaults to `development`, so it cannot be the only thing standing
// between `--reset` and a real database. Gate on the database name and fail loud.
const RESETTABLE_DATABASE = /^(postgres|.*_dev|.*_test)$/;

function assertResettableDatabase(): void {
  const name = new URL(env.DATABASE_URL).pathname.slice(1);

  if (!RESETTABLE_DATABASE.test(name)) {
    throw new Error(
      `Refusing to drop the schema of database "${name}". ` +
        "--reset only runs against a database named postgres, *_dev or *_test.",
    );
  }
}

async function resetSchema(): Promise<void> {
  assertResettableDatabase();
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();

  try {
    await client.query(
      "drop schema public cascade; create schema public; drop schema if exists drizzle cascade;",
    );
  } finally {
    await client.end();
  }

  await runMigrations();
}

async function createUser(email: string, name: string): Promise<Person> {
  const { id } = await createUserWithPassword({ email, name, password: PASSWORD });

  const { headers } = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    returnHeaders: true,
  });

  const cookie = headers.get("set-cookie")?.split(";")[0];

  if (!cookie) {
    throw new Error(`Sign-in for ${email} returned no session cookie`);
  }

  return { email, name, id, headers: new Headers({ cookie }) };
}

async function addMember(
  organizationId: string,
  person: Person,
  role: RoleKey = "reception",
): Promise<void> {
  await auth.api.addMember({
    body: { userId: person.id, organizationId, role },
  });
}

async function main(): Promise<void> {
  if (env.NODE_ENV === "production") {
    throw new Error("Refusing to seed a production database.");
  }

  const reset = process.argv.includes("--reset");

  if (reset) {
    console.info("Dropping and re-migrating the schema…");
    await resetSchema();
  }

  const [existing] = await db.select({ value: count() }).from(user);

  if (existing && existing.value > 0) {
    console.info(
      `Database already has ${existing.value} user(s); leaving it alone.\n` +
        "Re-run with `bun run db:seed -- --reset` to wipe and reseed.",
    );

    return;
  }

  const owner = await createUser("owner@example.com", "Ada Lovelace");
  const orgIds: string[] = [];

  for (const profile of ORGS) {
    const org = await createOrganization(
      owner.id,
      createOrganizationInput.parse(profile.organization),
    );

    orgIds.push(org.id);
  }

  const meridian = orgIds[0]!;
  const admin = await createUser("admin@example.com", "Grace Hopper");
  const staff = await createUser("staff@example.com", "Alan Turing");
  await addMember(meridian, admin, "admin");
  await addMember(meridian, staff);

  // Left unaccepted, so the Members page shows an invited row on arrival.
  await auth.api.createInvitation({
    body: { email: "invited@example.com", role: "reception", organizationId: meridian },
    headers: owner.headers,
  });

  const books = await Promise.all(
    ORGS.map((profile, index) => seedBooks(orgIds[index]!, profile, index)),
  );

  console.info(
    [
      "",
      "Seeded.",
      "",
      `  Password for every account below: ${PASSWORD}`,
      "",
      "  owner@example.com   owner      Meridian Traders + Ridgeview Academy",
      "  admin@example.com   admin      Meridian Traders",
      "  staff@example.com   reception  Meridian Traders",
      "  invited@example.com has a pending invitation to Meridian Traders.",
      "",
      ...ORGS.map(({ organization: { name } }, index) => {
        const b = books[index]!;

        return (
          `  ${name}: ${b.parties} parties (${b.inactive} inactive), ` +
          `${b.receipts} receipts (${b.advances} advances, ${b.cancelled} cancelled)`
        );
      }),
      "",
      "  admin@example.com can read the audit log;",
      "  staff@example.com cannot — that denial is itself audited.",
      "",
      "  More receipts for the volume check: bun run db:seed:volume",
      "  New accounts are created by an operator:",
      "  bun run create-user <email> <name> <password>",
      "",
      `  ${env.CORS_ORIGIN}/login`,
      "",
    ].join("\n"),
  );
}

if (import.meta.main) {
  await main();

  process.exit(0);
}
