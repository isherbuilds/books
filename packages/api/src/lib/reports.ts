import { db, type DbTransaction } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { documents } from "@accly/db/schema/documents";
import { journalEntries } from "@accly/db/schema/journal-entries";
import { journalLines } from "@accly/db/schema/journal-lines";
import { organizationSettings } from "@accly/db/schema/organization-settings";
import { parties } from "@accly/db/schema/parties";
import { and, asc, eq, gte, inArray, lt, lte, sql, type AnyColumn } from "drizzle-orm";

import { badRequest, impossible } from "./conflict";

export type LedgerCursor = { entryDate: string; id: string };

// A row comparison, not `a > x OR (a = x AND b > y)`: PostgreSQL seeks the
// (…, entry_date, id) index to the cursor instead of filtering every earlier row.
export const afterCursor = (date: AnyColumn, id: AnyColumn, cursor: LedgerCursor) =>
  sql`(${date}, ${id}) > (${cursor.entryDate}::date, ${cursor.id})`;

export type ReportHeader = {
  organization: { legalName: string; gstin: string | null };
  timeZone: string;
  range: { from: string; to: string } | { asOf: string };
  generatedAt: Date;
};

type ActivityRange = { before: string } | { from: string; to: string };

export type AccountActivity = {
  accountId: string;
  debitPaise: bigint;
  creditPaise: bigint;
};

export async function accountActivity(
  orgId: string,
  range: ActivityRange,
  executor: typeof db | DbTransaction = db,
  accountId?: string,
): Promise<AccountActivity[]> {
  const dateCondition =
    "before" in range
      ? lt(journalLines.entryDate, range.before)
      : and(gte(journalLines.entryDate, range.from), lte(journalLines.entryDate, range.to));

  return executor
    .select({
      accountId: journalLines.accountId,
      debitPaise: sql<bigint>`sum(${journalLines.debit})::bigint`.mapWith(BigInt),
      creditPaise: sql<bigint>`sum(${journalLines.credit})::bigint`.mapWith(BigInt),
    })
    .from(journalLines)
    .where(
      and(
        eq(journalLines.orgId, orgId),
        dateCondition,
        accountId ? eq(journalLines.accountId, accountId) : undefined,
      ),
    )
    .groupBy(journalLines.accountId);
}

export async function accountActivitySince(
  orgId: string,
  range: { through: string; since: string },
  executor: typeof db | DbTransaction = db,
) {
  return executor
    .select({
      accountId: journalLines.accountId,
      debitPaise: sql<bigint>`sum(${journalLines.debit})::bigint`.mapWith(BigInt),
      creditPaise: sql<bigint>`sum(${journalLines.credit})::bigint`.mapWith(BigInt),
      sinceDebitPaise:
        sql<bigint>`coalesce(sum(${journalLines.debit}) filter (where ${journalLines.entryDate} >= ${range.since}), 0)::bigint`.mapWith(
          BigInt,
        ),
      sinceCreditPaise:
        sql<bigint>`coalesce(sum(${journalLines.credit}) filter (where ${journalLines.entryDate} >= ${range.since}), 0)::bigint`.mapWith(
          BigInt,
        ),
    })
    .from(journalLines)
    .where(and(eq(journalLines.orgId, orgId), lte(journalLines.entryDate, range.through)))
    .groupBy(journalLines.accountId);
}

export type ReportProfile = Pick<
  typeof organizationSettings.$inferSelect,
  "legalName" | "gstin" | "timeZone" | "financialYearStart"
>;

export async function reportProfile(orgId: string, executor: typeof db | DbTransaction = db) {
  const [profile] = await executor
    .select({
      legalName: organizationSettings.legalName,
      gstin: organizationSettings.gstin,
      timeZone: organizationSettings.timeZone,
      financialYearStart: organizationSettings.financialYearStart,
    })
    .from(organizationSettings)
    .where(eq(organizationSettings.orgId, orgId))
    .limit(1);

  if (!profile) throw impossible("organization settings missing for report");

  return profile;
}

export function headerFromProfile(
  profile: ReportProfile,
  range: ReportHeader["range"],
): ReportHeader {
  return {
    organization: { legalName: profile.legalName, gstin: profile.gstin },
    timeZone: profile.timeZone,
    range,
    generatedAt: new Date(),
  };
}

export async function reportHeader(
  orgId: string,
  range: ReportHeader["range"],
  executor: typeof db | DbTransaction = db,
): Promise<ReportHeader> {
  return headerFromProfile(await reportProfile(orgId, executor), range);
}

export function reportTooLarge(limit: number) {
  return badRequest(
    "REPORT_TOO_LARGE",
    `This report exceeds ${limit.toLocaleString("en-IN")} lines; choose a shorter period.`,
  );
}

export async function accountLedgerLines(
  orgId: string,
  input: {
    accountId: string;
    from: string;
    to: string;
    cursor?: { entryDate: string; id: string };
  },
  limit: number,
  executor: typeof db | DbTransaction = db,
) {
  return executor
    .select({
      id: journalLines.id,
      entryId: journalEntries.id,
      entryDate: journalLines.entryDate,
      kind: journalEntries.kind,
      documentId: journalEntries.documentId,
      documentType: journalEntries.documentType,
      number: documents.number,
      narration: journalEntries.narration,
      partyName: parties.name,
      debitPaise: journalLines.debit,
      creditPaise: journalLines.credit,
    })
    .from(journalLines)
    .innerJoin(
      journalEntries,
      and(eq(journalEntries.orgId, orgId), eq(journalEntries.id, journalLines.entryId)),
    )
    .leftJoin(
      documents,
      and(eq(documents.orgId, orgId), eq(documents.id, journalEntries.documentId)),
    )
    .leftJoin(parties, and(eq(parties.orgId, orgId), eq(parties.id, journalLines.partyId)))
    .where(
      and(
        eq(journalLines.orgId, orgId),
        eq(journalLines.accountId, input.accountId),
        gte(journalLines.entryDate, input.from),
        lte(journalLines.entryDate, input.to),
        input.cursor
          ? afterCursor(journalLines.entryDate, journalLines.id, input.cursor)
          : undefined,
      ),
    )
    .orderBy(asc(journalLines.entryDate), asc(journalLines.id))
    .limit(limit + 1);
}

export async function dayBookLines(
  orgId: string,
  input: { from: string; to: string; documentType?: string; entryIds?: string[] },
  limit: number | undefined,
  executor: typeof db | DbTransaction = db,
) {
  const query = executor
    .select({
      entryId: journalEntries.id,
      entryDate: journalEntries.entryDate,
      kind: journalEntries.kind,
      documentId: journalEntries.documentId,
      documentType: journalEntries.documentType,
      number: documents.number,
      narration: journalEntries.narration,
      accountCode: accounts.code,
      accountName: accounts.name,
      partyName: parties.name,
      debitPaise: journalLines.debit,
      creditPaise: journalLines.credit,
    })
    .from(journalEntries)
    .innerJoin(
      journalLines,
      and(eq(journalLines.orgId, orgId), eq(journalLines.entryId, journalEntries.id)),
    )
    .innerJoin(accounts, and(eq(accounts.orgId, orgId), eq(accounts.id, journalLines.accountId)))
    .leftJoin(parties, and(eq(parties.orgId, orgId), eq(parties.id, journalLines.partyId)))
    .leftJoin(
      documents,
      and(eq(documents.orgId, orgId), eq(documents.id, journalEntries.documentId)),
    )
    .where(
      and(
        eq(journalEntries.orgId, orgId),
        input.entryIds ? inArray(journalEntries.id, input.entryIds) : undefined,
        gte(journalEntries.entryDate, input.from),
        lte(journalEntries.entryDate, input.to),
        input.documentType ? eq(journalEntries.documentType, input.documentType) : undefined,
      ),
    )
    .orderBy(asc(journalEntries.entryDate), asc(journalEntries.id), asc(journalLines.id))
    .$dynamic();

  return limit === undefined ? query : query.limit(limit + 1);
}
