import { businessDate } from "@accly/api/lib/business-date";
import { db } from "@accly/db";
import { documents } from "@accly/db/schema/documents";
import { journalLines } from "@accly/db/schema/journal-lines";
import { partyLedgerLines } from "@accly/db/schema/party-ledger-lines";
import { env } from "@accly/env/server";
import { and, count, eq } from "drizzle-orm";

import {
  ORGS,
  loadBooksOrg,
  mulberry32,
  planReceipts,
  postReceipts,
  shiftDate,
  type OrgProfile,
} from "./seed";

// Run `bun run db:seed` first, then `bun run db:seed:volume` from the repo root.
// Tops each seeded organization up to RECEIPT_COUNT receipts over the last year, through
// the same core posting path as the app. A rerun with enough receipts does nothing.

// The default, 100,000 receipts per organization (about 200,000 journal lines), is the
// smallest set a performance baseline may quote. Pass a smaller count for a quick check.
const RECEIPT_COUNT = Number(process.argv[2] ?? 100_000);

if (!Number.isInteger(RECEIPT_COUNT) || RECEIPT_COUNT < 1) {
  throw new Error(`Pass a positive whole receipt count, not "${process.argv[2]}"`);
}

const DAYS = 365;

const VOLUME_SEED = 0x0010_2026;

async function countWhere(table: typeof documents | typeof journalLines, orgId: string) {
  const [row] = await db.select({ value: count() }).from(table).where(eq(table.orgId, orgId));

  return row?.value ?? 0;
}

async function seedOrganization(profile: OrgProfile, index: number): Promise<string> {
  const { slug } = profile.organization;
  const org = await loadBooksOrg(slug);
  const { orgId } = org.scope;

  const [existing] = await db
    .select({ value: count() })
    .from(documents)
    .where(and(eq(documents.orgId, orgId), eq(documents.type, "receipt")));

  const missing = RECEIPT_COUNT - (existing?.value ?? 0);

  if (missing > 0) {
    // Spread evenly, oldest first, so numbers and ids follow the document date.
    const today = businessDate(new Date(), org.settings.timeZone);

    const days = Array.from({ length: DAYS }, (_, offset) => ({
      date: shiftDate(today, offset - DAYS + 1),
      count: Math.floor((missing * (offset + 1)) / DAYS) - Math.floor((missing * offset) / DAYS),
    }));

    const started = performance.now();
    const plans = planReceipts(org, profile, mulberry32(VOLUME_SEED + index), days);
    await postReceipts(org, plans);

    console.info(
      `${slug}: posted ${plans.length} receipts in ${((performance.now() - started) / 1000).toFixed(1)} s`,
    );
  } else {
    console.info(`${slug}: found ${existing?.value ?? 0} receipts; skipping.`);
  }

  const [receipts, lines, [ledger]] = await Promise.all([
    countWhere(documents, orgId),
    countWhere(journalLines, orgId),
    db.select({ value: count() }).from(partyLedgerLines).where(eq(partyLedgerLines.orgId, orgId)),
  ]);

  return `  ${slug}: ${receipts} documents, ${lines} journal lines, ${ledger?.value ?? 0} party ledger lines`;
}

if (env.NODE_ENV === "production") throw new Error("Refusing to seed a production database.");

const summaries = await Promise.all(ORGS.map(seedOrganization));

console.info(["", "Volume seed summary:", ...summaries].join("\n"));

process.exit(0);
