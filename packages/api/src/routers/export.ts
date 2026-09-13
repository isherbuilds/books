import { db } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { documents } from "@accly/db/schema/documents";
import { journalEntries } from "@accly/db/schema/journal-entries";
import { journalLines } from "@accly/db/schema/journal-lines";
import { parties } from "@accly/db/schema/parties";
import { and, asc, eq } from "drizzle-orm";
import { writeXlsx } from "hucre/xlsx";
import { z } from "zod";

import { orgInput, orgProcedure } from "../lib/procedures/factory";

const BOLD_HEADER = { style: { font: { bold: true } } };

const columns = [
  { header: "Date", key: "date", width: 14 },
  { header: "Document", key: "document", width: 18 },
  { header: "Type", key: "type", width: 16 },
  { header: "Kind", key: "kind", width: 12 },
  { header: "Account code", key: "accountCode", width: 16 },
  { header: "Account", key: "account", width: 28 },
  { header: "Party", key: "party", width: 24 },
  { header: "Debit", key: "debit", width: 14 },
  { header: "Credit", key: "credit", width: 14 },
  { header: "Narration", key: "narration", width: 36 },
];

export const exportRouter = {
  dayBookXlsx: orgProcedure({ export: ["read"] }, orgInput.extend({ date: z.iso.date() })).handler(
    async ({ context, input }) => {
      const { orgId } = context.scope;

      const rows = await db
        .select({
          entryDate: journalEntries.entryDate,
          documentNumber: documents.number,
          documentType: journalEntries.documentType,
          kind: journalEntries.kind,
          accountCode: accounts.code,
          accountName: accounts.name,
          partyName: parties.name,
          debit: journalLines.debit,
          credit: journalLines.credit,
          narration: journalEntries.narration,
        })
        .from(journalEntries)
        .innerJoin(
          journalLines,
          and(eq(journalLines.orgId, orgId), eq(journalLines.entryId, journalEntries.id)),
        )
        .innerJoin(
          accounts,
          and(eq(accounts.orgId, orgId), eq(accounts.id, journalLines.accountId)),
        )
        .leftJoin(parties, and(eq(parties.orgId, orgId), eq(parties.id, journalLines.partyId)))
        .leftJoin(
          documents,
          and(eq(documents.orgId, orgId), eq(documents.id, journalEntries.documentId)),
        )
        .where(and(eq(journalEntries.orgId, orgId), eq(journalEntries.entryDate, input.date)))
        .orderBy(asc(journalEntries.id), asc(journalLines.id));

      const bytes = await writeXlsx({
        sheets: [
          {
            name: "Day book",
            columns,
            data: rows.map((row) => ({
              date: row.entryDate,
              document: row.documentNumber ?? "",
              type: row.documentType,
              kind: row.kind,
              accountCode: row.accountCode,
              account: row.accountName,
              party: row.partyName ?? "",
              debit: Number(row.debit) / 100,
              credit: Number(row.credit) / 100,
              narration: row.narration,
            })),
            cells: new Map(columns.map((_, index) => [`0,${index}`, BOLD_HEADER])),
          },
        ],
      });

      // SAFETY: hucre 1.1.0 ZipWriter.build allocates new Uint8Array(totalSize), so
      // this unencrypted writeXlsx result has an ArrayBuffer, never SharedArrayBuffer.
      return new File([bytes as Uint8Array<ArrayBuffer>], `day-book-${input.date}.xlsx`, {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
    },
  ),
};
