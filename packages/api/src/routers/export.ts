import { db } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { documents } from "@accly/db/schema/documents";
import { journalEntries } from "@accly/db/schema/journal-entries";
import { journalLines } from "@accly/db/schema/journal-lines";
import { parties } from "@accly/db/schema/parties";
import { tdsDeductions } from "@accly/db/schema/tds-deductions";
import { tdsSections } from "@accly/db/schema/tds-sections";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { writeXlsx } from "hucre/xlsx";

import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { dateOnly, orderedPeriod } from "../lib/schemas";

const BOLD_HEADER = { style: { font: { bold: true } } };

type Sheet = Parameters<typeof writeXlsx>[0]["sheets"][number];

// One sheet with a bold header row, returned as a downloadable file.
async function xlsxFile(
  fileName: string,
  name: string,
  sheetColumns: NonNullable<Sheet["columns"]>,
  data: Sheet["data"],
): Promise<File> {
  const bytes = await writeXlsx({
    sheets: [
      {
        name,
        columns: sheetColumns,
        data,
        cells: new Map(sheetColumns.map((_, index) => [`0,${index}`, BOLD_HEADER])),
      },
    ],
  });

  // SAFETY: hucre 1.1.0 ZipWriter.build allocates new Uint8Array(totalSize), so
  // this unencrypted writeXlsx result has an ArrayBuffer, never SharedArrayBuffer.
  return new File([bytes as Uint8Array<ArrayBuffer>], fileName, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

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

const tdsColumns = [
  { header: "Date", key: "date", width: 14 },
  { header: "Document", key: "document", width: 18 },
  { header: "Type", key: "type", width: 14 },
  { header: "Section", key: "section", width: 14 },
  { header: "Rate %", key: "rate", width: 10 },
  { header: "Party", key: "party", width: 24 },
  { header: "Party PAN", key: "partyPan", width: 16 },
  { header: "Gross", key: "gross", width: 14 },
  { header: "TDS", key: "tds", width: 14 },
  { header: "Net", key: "net", width: 14 },
];

export const exportRouter = {
  dayBookXlsx: orgProcedure({ export: ["read"] }, orgInput.extend({ date: dateOnly })).handler(
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

      return xlsxFile(
        `day-book-${input.date}.xlsx`,
        "Day book",
        columns,
        rows.map((row) => ({
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
      );
    },
  ),
  tdsRegisterXlsx: orgProcedure(
    { export: ["read"] },
    orgInput.extend({ from: dateOnly, to: dateOnly }).superRefine(orderedPeriod),
  ).handler(async ({ context, input }) => {
    const { orgId } = context.scope;

    // Deductions in force. A cancelled Payment drops out; a quarter already filed is
    // corrected through a Form 140 correction statement, and the day book keeps the reversal.
    const rows = await db
      .select({
        documentDate: documents.documentDate,
        number: documents.number,
        type: documents.type,
        code: tdsSections.code,
        rateBasisPoints: tdsSections.rateBasisPoints,
        partyName: sql<string | null>`${documents.printSnapshot}->'party'->>'name'`,
        partyPan: sql<string | null>`${documents.printSnapshot}->'party'->>'pan'`,
        totalPaise: documents.totalPaise,
        tdsPaise: tdsDeductions.amountPaise,
      })
      .from(documents)
      .innerJoin(
        tdsDeductions,
        and(eq(tdsDeductions.orgId, orgId), eq(tdsDeductions.documentId, documents.id)),
      )
      .innerJoin(
        tdsSections,
        and(eq(tdsSections.orgId, orgId), eq(tdsSections.id, tdsDeductions.tdsSectionId)),
      )
      .where(
        and(
          eq(documents.orgId, orgId),
          eq(documents.type, "payment"),
          eq(documents.state, "posted"),
          gte(documents.documentDate, input.from),
          lte(documents.documentDate, input.to),
        ),
      )
      .orderBy(asc(documents.documentDate), asc(documents.id));

    return xlsxFile(
      `tds-register-${input.from}-${input.to}.xlsx`,
      "TDS register",
      tdsColumns,
      rows.map((row) => ({
        date: row.documentDate,
        document: row.number,
        type: row.type,
        section: row.code,
        rate: row.rateBasisPoints / 100,
        party: row.partyName,
        partyPan: row.partyPan,
        gross: Number(row.totalPaise) / 100,
        tds: Number(row.tdsPaise) / 100,
        net: Number(row.totalPaise - row.tdsPaise) / 100,
      })),
    );
  }),
};
