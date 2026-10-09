import { db, type DbTransaction } from "@accly/db";
import { allocations } from "@accly/db/schema/allocations";
import { accounts } from "@accly/db/schema/accounts";
import { documents } from "@accly/db/schema/documents";
import { journalEntries, type EntryDocumentType } from "@accly/db/schema/journal-entries";
import { journalLines } from "@accly/db/schema/journal-lines";
import { organizationSettings } from "@accly/db/schema/organization-settings";
import { parties } from "@accly/db/schema/parties";
import { and, asc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { badRequest, impossible } from "./conflict";
import { afterCursor } from "./pagination";
import { paiseSum } from "./sql";

const sourceDocument = alias(documents, "report_source_document");

const targetDocument = alias(documents, "report_target_document");

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
      debitPaise: paiseSum(journalLines.debit),
      creditPaise: paiseSum(journalLines.credit),
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
      debitPaise: paiseSum(journalLines.debit),
      creditPaise: paiseSum(journalLines.credit),
      sinceDebitPaise: paiseSum(
        journalLines.debit,
        sql`${journalLines.entryDate} >= ${range.since}`,
      ),
      sinceCreditPaise: paiseSum(
        journalLines.credit,
        sql`${journalLines.entryDate} >= ${range.since}`,
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

/**
 * Refuses a report whose rows pass `limit` before its joined read runs. The probe is
 * the report's own filter and order over one index, seeked to the row after the limit,
 * so an oversized request fails in one index walk instead of a join that times out.
 */
export async function assertReportFits(
  probe: { offset: (offset: number) => { limit: (limit: number) => PromiseLike<unknown[]> } },
  limit: number,
): Promise<void> {
  const [past] = await probe.offset(limit).limit(1);

  if (past) throw reportTooLarge(limit);
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
      contraAccountName: sql<string | null>`(
        select case
          when count(distinct contra_line.account_id) > 1 then 'Multiple'
          else min(contra_account.name)
        end
        from journal_lines contra_line
        join accounts contra_account
          on contra_account.org_id = ${orgId} and contra_account.id = contra_line.account_id
        where contra_line.org_id = ${orgId}
          and contra_line.entry_id = ${journalLines.entryId}
          and contra_line.account_id <> ${journalLines.accountId}
      )`,
      sourceDocumentId: sourceDocument.id,
      sourceDocumentType: sourceDocument.type,
      sourceNumber: sourceDocument.number,
      targetNumber: targetDocument.number,
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
    .leftJoin(
      allocations,
      and(
        eq(allocations.orgId, orgId),
        eq(allocations.id, journalEntries.documentId),
        eq(journalEntries.documentType, "allocation"),
      ),
    )
    .leftJoin(
      sourceDocument,
      and(eq(sourceDocument.orgId, orgId), eq(sourceDocument.id, allocations.sourceDocumentId)),
    )
    .leftJoin(
      targetDocument,
      and(eq(targetDocument.orgId, orgId), eq(targetDocument.id, allocations.targetDocumentId)),
    )
    .where(
      and(
        accountLedgerWhere(orgId, input),
        input.cursor
          ? afterCursor(journalLines.entryDate, journalLines.id, input.cursor)
          : undefined,
      ),
    )
    .orderBy(asc(journalLines.entryDate), asc(journalLines.id))
    .limit(limit);
}

function accountLedgerWhere(orgId: string, input: { accountId: string; from: string; to: string }) {
  return and(
    eq(journalLines.orgId, orgId),
    eq(journalLines.accountId, input.accountId),
    gte(journalLines.entryDate, input.from),
    lte(journalLines.entryDate, input.to),
  );
}

/** The ledger's lines in order, read from `journal_lines_org_account_date_idx` alone. */
export function accountLedgerProbe(
  orgId: string,
  input: { accountId: string; from: string; to: string },
  executor: typeof db | DbTransaction = db,
) {
  return executor
    .select({ id: journalLines.id })
    .from(journalLines)
    .where(accountLedgerWhere(orgId, input))
    .orderBy(asc(journalLines.entryDate), asc(journalLines.id));
}

/** Probe the day book's line bound without selecting or materializing report detail. */
export function dayBookProbe(
  orgId: string,
  input: { from: string; to: string; documentType?: EntryDocumentType },
  executor: typeof db | DbTransaction = db,
) {
  return executor
    .select({ id: journalLines.id })
    .from(journalEntries)
    .innerJoin(
      journalLines,
      and(eq(journalLines.orgId, orgId), eq(journalLines.entryId, journalEntries.id)),
    )
    .where(
      and(
        eq(journalEntries.orgId, orgId),
        gte(journalEntries.entryDate, input.from),
        lte(journalEntries.entryDate, input.to),
        input.documentType ? eq(journalEntries.documentType, input.documentType) : undefined,
      ),
    )
    .orderBy(asc(journalEntries.entryDate), asc(journalEntries.id), asc(journalLines.id));
}

export async function dayBookLines(
  orgId: string,
  input: { from: string; to: string; documentType?: EntryDocumentType; entryIds?: string[] },
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
      sourceDocumentId: sourceDocument.id,
      sourceDocumentType: sourceDocument.type,
      sourceNumber: sourceDocument.number,
      targetNumber: targetDocument.number,
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
    .leftJoin(
      allocations,
      and(
        eq(allocations.orgId, orgId),
        eq(allocations.id, journalEntries.documentId),
        eq(journalEntries.documentType, "allocation"),
      ),
    )
    .leftJoin(
      sourceDocument,
      and(eq(sourceDocument.orgId, orgId), eq(sourceDocument.id, allocations.sourceDocumentId)),
    )
    .leftJoin(
      targetDocument,
      and(eq(targetDocument.orgId, orgId), eq(targetDocument.id, allocations.targetDocumentId)),
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

  return limit === undefined ? query : query.limit(limit);
}
