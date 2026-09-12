import { db } from "@accly/db";
import { organization } from "@accly/db/schema/auth";
import { ITEM_CATEGORIES, items } from "@accly/db/schema/items";
import { counter } from "@accly/db/schema/counter";
import { SETTINGS_DEFAULTS, organizationSettings } from "@accly/db/schema/organization-settings";
import { customers } from "@accly/db/schema/customers";
import { env } from "@accly/env/server";
import { count, eq, inArray, sql } from "drizzle-orm";

// Run the normal seed first, then `bun scripts/seed-volume.ts` from the repo root.

const ORG_SLUGS = ["meridian-traders", "ridgeview-academy"] as const;

const CUSTOMER_COUNT = 20_000;

const ITEM_ITEM_COUNT = 1_000;

const BATCH_SIZE = 1_000;

const ALREADY_SEEDED_THRESHOLD = 10_000;

const FIXED_SEED = 0x5eed_2026;

const ANCHOR_DATE = new Date("2026-08-01T00:00:00.000Z");

const DAY_MS = 24 * 60 * 60 * 1_000;

const GIVEN_NAMES = [
  "Aarav",
  "Aditi",
  "Aditya",
  "Akash",
  "Ananya",
  "Anika",
  "Anil",
  "Aradhya",
  "Arjun",
  "Bhavna",
  "Charu",
  "Deepak",
  "Devika",
  "Divya",
  "Gaurav",
  "Harish",
  "Ishaan",
  "Ishita",
  "Jaya",
  "Karan",
  "Kavita",
  "Kiran",
  "Kranti",
  "Lakshmi",
  "Manish",
  "Meera",
  "Mohan",
  "Nandini",
  "Neha",
  "Nikhil",
  "Pooja",
  "Prachi",
  "Pradeep",
  "Prakash",
  "Pranav",
  "Priya",
  "Rahul",
  "Rajesh",
  "Rani",
  "Ravi",
  "Rohit",
  "Sanjay",
  "Shravan",
  "Sneha",
  "Suraj",
  "Tanvi",
  "Varsha",
  "Vijay",
  "Viraj",
  "Zoya",
] as const;

const FAMILY_NAMES = [
  "Agarwal",
  "Ahuja",
  "Bajaj",
  "Banerjee",
  "Batra",
  "Bhat",
  "Bose",
  "Chandra",
  "Chatterjee",
  "Chauhan",
  "Chopra",
  "Das",
  "Desai",
  "Deshmukh",
  "Dutta",
  "Gandhi",
  "Gill",
  "Goswami",
  "Gupta",
  "Iyer",
  "Jain",
  "Joshi",
  "Kapoor",
  "Kaur",
  "Khanna",
  "Kumar",
  "Kulkarni",
  "Malhotra",
  "Mehta",
  "Menon",
  "Mishra",
  "Mukherjee",
  "Nair",
  "Pandey",
  "Patel",
  "Prasad",
  "Raghavan",
  "Rajan",
  "Rana",
  "Rao",
  "Raut",
  "Reddy",
  "Roy",
  "Saxena",
  "Shah",
  "Sharma",
  "Singh",
  "Sinha",
  "Trivedi",
  "Verma",
] as const;

const LOCALITIES = [
  "Ashok Nagar",
  "Banjara Hills",
  "Civil Lines",
  "Gandhi Road",
  "Indira Nagar",
  "Lake View",
  "MG Road",
  "Rajendra Nagar",
] as const;

const CITIES = ["Bengaluru", "Chennai", "Delhi", "Hyderabad", "Kolkata", "Mumbai", "Pune"] as const;

const SEXES = ["male", "female", "other", "unknown"] as const;

const TAX_RATES = ["0", "5", "12", "18"] as const;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b_79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function deterministicUuidV7(
  date: Date,
  random: () => number,
  namespace: number,
  orgIndex: number,
  rowIndex: number,
): string {
  const timestamp = BigInt(date.getTime()).toString(16).padStart(12, "0");
  const randomA = (((random() * 4_294_967_296) >>> 0) & 0x0fff).toString(16).padStart(3, "0");

  const randomB = ((((random() * 4_294_967_296) >>> 0) & 0x3fff) | 0x8000)
    .toString(16)
    .padStart(4, "0");

  const uniqueTail =
    (BigInt(namespace & 0xff) << 40n) | (BigInt(orgIndex & 0xff) << 32n) | BigInt(rowIndex + 1);

  return `${timestamp.slice(0, 8)}-${timestamp.slice(8)}-7${randomA}-${randomB}-${uniqueTail
    .toString(16)
    .padStart(12, "0")}`;
}

function customerCreatedAt(random: () => number): Date {
  const offset = Math.floor(random() * 365 * DAY_MS);

  return new Date(ANCHOR_DATE.getTime() - offset);
}

function dateOfBirth(index: number): string {
  const year = 1940 + (index % 75);
  const month = String((index % 12) + 1).padStart(2, "0");
  const day = String((index % 28) + 1).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function customerPhone(index: number, orgIndex: number): string {
  const firstDigit = 6 + ((index + orgIndex) % 4);
  const subscriber = orgIndex * CUSTOMER_COUNT + index;

  return `${firstDigit}${String(subscriber).padStart(9, "0")}`;
}

type OrganizationSeed = {
  id: string;
  slug: (typeof ORG_SLUGS)[number];
  orgIndex: number;
};

type SeedSummary = {
  slug: string;
  customersInserted: number;
  itemsInserted: number;
  elapsedMs: number;
};

async function resolveOrganizations(): Promise<OrganizationSeed[]> {
  const rows = await db
    .select({ id: organization.id, slug: organization.slug })
    .from(organization)
    .where(inArray(organization.slug, ORG_SLUGS));

  const bySlug = new Map(rows.map((row) => [row.slug, row.id]));
  const missing = ORG_SLUGS.filter((slug) => !bySlug.has(slug));

  if (missing.length > 0) {
    throw new Error(
      `Missing required organization(s): ${missing.join(", ")}. Run \`bun run db:seed\` first.`,
    );
  }

  return ORG_SLUGS.map((slug, orgIndex) => ({
    id: bySlug.get(slug)!,
    slug,
    orgIndex,
  }));
}

async function readCodePrefix(orgId: string): Promise<string> {
  const [settings] = await db
    .select({ codePrefix: organizationSettings.codePrefix })
    .from(organizationSettings)
    .where(eq(organizationSettings.orgId, orgId))
    .limit(1);

  return settings?.codePrefix ?? SETTINGS_DEFAULTS.codePrefix;
}

async function seedOrganization(org: OrganizationSeed): Promise<SeedSummary> {
  const startedAt = performance.now();
  const codePrefix = await readCodePrefix(org.id);
  const random = mulberry32(FIXED_SEED + org.orgIndex);

  const inserted = await db.transaction(async (tx) => {
    // Serialize concurrent volume seeds for the same org before the count gate.
    await tx.execute(
      sql`select ${organization.id} from ${organization} where ${organization.id} = ${org.id} for update`,
    );

    const [existing] = await tx
      .select({ value: count() })
      .from(customers)
      .where(eq(customers.orgId, org.id));

    const existingCustomerCount = existing?.value ?? 0;

    if (existingCustomerCount > ALREADY_SEEDED_THRESHOLD) {
      console.info(
        `${org.slug}: found ${existingCustomerCount} customers; skipping volume seed for this organization.`,
      );

      return { customersInserted: 0, itemsInserted: 0 };
    }

    // The batched equivalent of CUSTOMER_COUNT calls to nextCounter.
    const [sequence] = await tx
      .insert(counter)
      .values({ orgId: org.id, key: "code", value: CUSTOMER_COUNT })
      .onConflictDoUpdate({
        target: [counter.orgId, counter.key],
        set: { value: sql`${counter.value} + ${CUSTOMER_COUNT}` },
      })
      .returning({ finalValue: counter.value });

    if (!sequence) {
      throw new Error(`Code counter update returned no row for organization "${org.slug}"`);
    }

    const firstSequence = sequence.finalValue - CUSTOMER_COUNT + 1;

    for (let start = 0; start < CUSTOMER_COUNT; start += BATCH_SIZE) {
      const rows: (typeof customers.$inferInsert)[] = [];

      for (let offset = 0; offset < BATCH_SIZE; offset += 1) {
        const index = start + offset;
        const createdAt = customerCreatedAt(random);
        const givenName = GIVEN_NAMES[Math.floor(random() * GIVEN_NAMES.length)]!;
        const familyName = FAMILY_NAMES[Math.floor(random() * FAMILY_NAMES.length)]!;
        const sequenceNumber = firstSequence + index;

        rows.push({
          id: deterministicUuidV7(createdAt, random, 1, org.orgIndex, index),
          orgId: org.id,
          code: `${codePrefix}${String(sequenceNumber).padStart(6, "0")}`,
          name: `${givenName} ${familyName}`,
          phone: customerPhone(index, org.orgIndex),
          sex: SEXES[index % SEXES.length]!,
          dateOfBirth: dateOfBirth(index),
          address: `${(index % 240) + 1}, ${LOCALITIES[index % LOCALITIES.length]}, ${CITIES[index % CITIES.length]}`,
          email: null,
          uid: String(100_000_000_000 + org.orgIndex * CUSTOMER_COUNT + index),
          createdBy: null,
          createdAt,
          updatedAt: createdAt,
        });
      }

      await tx.insert(customers).values(rows);
    }

    for (let start = 0; start < ITEM_ITEM_COUNT; start += BATCH_SIZE) {
      const rows: (typeof items.$inferInsert)[] = [];
      const end = Math.min(start + BATCH_SIZE, ITEM_ITEM_COUNT);

      for (let index = start; index < end; index += 1) {
        const category = ITEM_CATEGORIES[index % ITEM_CATEGORIES.length]!;
        const createdAt = new Date(ANCHOR_DATE.getTime() - (index % 365) * DAY_MS);
        rows.push({
          id: deterministicUuidV7(createdAt, random, 2, org.orgIndex, index),
          orgId: org.id,
          name: `${category[0]!.toUpperCase()}${category.slice(1)} Service ${String(index + 1).padStart(4, "0")}`,
          code: `VOL-${category.slice(0, 3).toUpperCase()}-${String(index + 1).padStart(4, "0")}`,
          category,
          unitPrice: BigInt(100 + ((index * 137) % 9_900)) * 100n,
          taxRatePercent: TAX_RATES[index % TAX_RATES.length]!,
          taxCode: index % 3 === 0 ? null : `SAC${998_300 + (index % 100)}`,
          active: index < 400,
          createdAt,
          updatedAt: createdAt,
        });
      }

      await tx.insert(items).values(rows);
    }

    return {
      customersInserted: CUSTOMER_COUNT,
      itemsInserted: ITEM_ITEM_COUNT,
    };
  });

  return {
    slug: org.slug,
    ...inserted,
    elapsedMs: Math.round(performance.now() - startedAt),
  };
}

async function main(): Promise<void> {
  if (env.NODE_ENV === "production") {
    throw new Error("Refusing to seed a production database.");
  }

  const organizations = await resolveOrganizations();
  const summaries: SeedSummary[] = [];

  for (const org of organizations) {
    summaries.push(await seedOrganization(org));
  }

  console.info("\nVolume seed summary:");

  for (const summary of summaries) {
    console.info(
      `  ${summary.slug}: ${summary.customersInserted} customers, ${summary.itemsInserted} item items, ${summary.elapsedMs} ms`,
    );
  }
}

await main();

process.exit(0);
