import { db, type DbTransaction } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { documentLines, type EntrySide } from "@accly/db/schema/document-lines";
import type { organizationSettings } from "@accly/db/schema/organization-settings";
import { parties } from "@accly/db/schema/parties";
import { and, asc, eq, inArray } from "drizzle-orm";

import { journalAccounts } from "../lib/accounts";
import { badRequest, impossible } from "../lib/conflict";
import type { Scope } from "../lib/procedures/factory";
import { accountLine, postDocument } from "./documents";

type EntryLine = {
  accountId: string;
  side: EntrySide;
  amount: bigint;
  description?: string;
  partyId?: string;
};

type PostEntryLinesInput = {
  type: "journal" | "openingBalance";
  documentDate: string;
  narration: string;
  reference: string | null;
  prefix: string;
  lines: readonly EntryLine[];
};

/** Resolves and posts the balanced account legs shared by Journals and Opening Balances. */
export async function postEntryLines(
  tx: DbTransaction,
  scope: Scope,
  settings: typeof organizationSettings.$inferSelect,
  input: PostEntryLinesInput,
): Promise<{ id: string; number: string; amountPaise: bigint }> {
  const accountIds = [...new Set(input.lines.map((line) => line.accountId))];

  const resolvedAccounts = await journalAccounts(tx, scope.orgId, {
    gstin: null,
    ids: accountIds,
  });

  if (resolvedAccounts.length !== accountIds.length) {
    throw badRequest(
      "ACCOUNT_INVALID",
      "Choose active leaf accounts; party control and GST accounts are posted by documents.",
    );
  }

  if (
    settings.gstin !== null &&
    resolvedAccounts.some((account) => account.supplyClass === "taxable")
  ) {
    throw badRequest("TAXABLE_ACCOUNT_LINE", "Taxable income is invoiced, not journaled.");
  }

  const partyIds =
    input.type === "journal"
      ? [...new Set(input.lines.flatMap((line) => (line.partyId ? [line.partyId] : [])))]
      : [];

  const resolvedParties =
    partyIds.length === 0
      ? []
      : await tx
          .select({ id: parties.id })
          .from(parties)
          .where(and(eq(parties.orgId, scope.orgId), inArray(parties.id, partyIds)));

  if (resolvedParties.length !== partyIds.length) {
    throw badRequest("PARTY_INVALID", "Choose a party in this organization.");
  }

  const accountById = new Map(resolvedAccounts.map((account) => [account.id, account]));

  const amountPaise = input.lines.reduce(
    (total, line) => (line.side === "debit" ? total + line.amount : total),
    0n,
  );

  const storedLines = input.lines.map((line) => {
    const account = accountById.get(line.accountId);

    if (!account) throw impossible(`validated entry account ${line.accountId} is missing`);

    return {
      ...accountLine(line.accountId, line.description ?? account.name, line.amount),
      entrySide: line.side,
      partyId: input.type === "journal" ? (line.partyId ?? null) : null,
    };
  });

  const journalLines = input.lines.map((line) => ({
    accountId: line.accountId,
    partyId: input.type === "journal" ? (line.partyId ?? null) : null,
    side: line.side,
    amountPaise: line.amount,
  }));

  const posting =
    input.type === "journal"
      ? { type: "journal" as const, amountPaise, lines: journalLines }
      : { type: "openingBalance" as const, amountPaise, lines: journalLines };

  const posted = await postDocument(tx, scope, settings, input.prefix, {
    documentDate: input.documentDate,
    dueDate: null,
    placeOfSupplyStateCode: null,
    reference: input.reference,
    narration: input.narration,
    affectsTax: false,
    printSnapshot: null,
    discountPaise: 0n,
    againstDocumentId: null,
    lines: storedLines,
    posting,
    draft: null,
  });

  return { ...posted, amountPaise };
}

/** A Journal's or Opening Balance's lines in entry order, each with its side. */
export async function entryLinesOf(orgId: string, documentId: string) {
  const rows = await db
    .select({
      id: documentLines.id,
      accountId: accounts.id,
      accountName: accounts.name,
      accountCode: accounts.code,
      side: documentLines.entrySide,
      partyId: documentLines.partyId,
      partyName: parties.name,
      description: documentLines.description,
      amountPaise: documentLines.amountPaise,
    })
    .from(documentLines)
    .innerJoin(accounts, and(eq(accounts.orgId, orgId), eq(accounts.id, documentLines.accountId)))
    .leftJoin(parties, and(eq(parties.orgId, orgId), eq(parties.id, documentLines.partyId)))
    .where(and(eq(documentLines.orgId, orgId), eq(documentLines.documentId, documentId)))
    .orderBy(asc(documentLines.position));

  return rows.map((line) => {
    if (line.side === null) throw impossible(`entry line ${line.id} has no entry side`);

    return { ...line, side: line.side };
  });
}
