import { db } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { documents } from "@accly/db/schema/documents";
import { journalEntries } from "@accly/db/schema/journal-entries";
import { journalLines } from "@accly/db/schema/journal-lines";
import { parties } from "@accly/db/schema/parties";
import { tdsDeductions } from "@accly/db/schema/tds-deductions";
import { tdsSections } from "@accly/db/schema/tds-sections";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { writeXlsx } from "hucre/xlsx";

import { buildInwardRegister, buildOutwardRegister, type RegisterLine } from "../core/gst-register";
import { gstRegisterRows } from "../lib/gst-register-rows";

import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { dateOnly, orderedPeriod } from "../lib/schemas";

const BOLD_HEADER = { style: { font: { bold: true } } };

type Sheet = Parameters<typeof writeXlsx>[0]["sheets"][number];

async function xlsxSheets(
  fileName: string,
  sheets: (Pick<Sheet, "name" | "data"> & { columns: NonNullable<Sheet["columns"]> })[],
): Promise<File> {
  const bytes = await writeXlsx({
    sheets: sheets.map((sheet) => ({
      ...sheet,
      cells: new Map(sheet.columns.map((_, index) => [`0,${index}`, BOLD_HEADER])),
    })),
  });

  // SAFETY: hucre 1.1.0 ZipWriter.build allocates new Uint8Array(totalSize), so
  // this unencrypted writeXlsx result has an ArrayBuffer, never SharedArrayBuffer.
  return new File([bytes as Uint8Array<ArrayBuffer>], fileName, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// One sheet with a bold header row, returned as a downloadable file.
function xlsxFile(
  fileName: string,
  name: string,
  sheetColumns: NonNullable<Sheet["columns"]>,
  data: Sheet["data"],
): Promise<File> {
  return xlsxSheets(fileName, [{ name, columns: sheetColumns, data }]);
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

const periodInput = orgInput.extend({ from: dateOnly, to: dateOnly }).superRefine(orderedPeriod);

const money = (paise: bigint) => Number(paise) / 100;

const gstColumns = [
  { header: "GSTIN", key: "gstin", width: 18 },
  { header: "Party", key: "party", width: 26 },
  { header: "Number", key: "number", width: 20 },
  { header: "Date", key: "date", width: 14 },
  { header: "Place of supply (state code)", key: "placeOfSupply", width: 29 },
  { header: "Rate (%)", key: "rate", width: 12 },
  { header: "Taxable", key: "taxable", width: 16 },
  { header: "IGST", key: "igst", width: 16 },
  { header: "CGST", key: "cgst", width: 16 },
  { header: "SGST", key: "sgst", width: 16 },
];

const againstColumns = [
  { header: "Against number", key: "againstNumber", width: 20 },
  { header: "Against date", key: "againstDate", width: 14 },
];

const gstAmounts = (row: {
  taxablePaise: bigint;
  igstPaise: bigint;
  cgstPaise: bigint;
  sgstPaise: bigint;
}) => ({
  taxable: money(row.taxablePaise),
  igst: money(row.igstPaise),
  cgst: money(row.cgstPaise),
  sgst: money(row.sgstPaise),
});

function gstDocument(
  row: Pick<
    RegisterLine,
    | "partyGstin"
    | "partyName"
    | "number"
    | "documentDate"
    | "placeOfSupplyStateCode"
    | "rateBasisPoints"
    | "against"
    | "taxablePaise"
    | "igstPaise"
    | "cgstPaise"
    | "sgstPaise"
  >,
) {
  return {
    gstin: row.partyGstin ?? "",
    party: row.partyName ?? "",
    number: row.number,
    date: row.documentDate,
    placeOfSupply: row.placeOfSupplyStateCode ?? "",
    rate: row.rateBasisPoints === null ? "" : row.rateBasisPoints / 100,
    ...gstAmounts(row),
    againstNumber: row.against?.number ?? "",
    againstDate: row.against?.documentDate ?? "",
  };
}

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
  tdsRegisterXlsx: orgProcedure({ export: ["read"] }, periodInput).handler(
    async ({ context, input }) => {
      const { orgId } = context.scope;

      // Deductions in force. Cancelled Bills and Payments drop out; a filed quarter is
      // corrected through a Form 140 correction statement, with its reversal in the day book.
      const rows = await db
        .select({
          documentDate: documents.documentDate,
          number: documents.number,
          type: documents.type,
          code: tdsSections.code,
          rateBasisPoints: tdsSections.rateBasisPoints,
          partyName: sql<string | null>`${documents.printSnapshot}->'party'->>'name'`,
          partyPan: sql<string | null>`${documents.printSnapshot}->'party'->>'pan'`,
          basePaise: tdsDeductions.basePaise,
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
            inArray(documents.type, ["payment", "bill"]),
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
          type: row.type === "bill" ? "Bill" : "Payment",
          section: row.code,
          rate: row.rateBasisPoints / 100,
          party: row.partyName,
          partyPan: row.partyPan,
          gross: money(row.basePaise),
          tds: money(row.tdsPaise),
          net: money(row.basePaise - row.tdsPaise),
        })),
      );
    },
  ),
  gstOutwardXlsx: orgProcedure({ export: ["read"] }, periodInput).handler(
    async ({ context, input }) => {
      const { orgId } = context.scope;
      const rows = await gstRegisterRows(orgId, input.from, input.to, "outward");
      const register = buildOutwardRegister(rows);

      return xlsxSheets(`gst-outward-${input.from}-${input.to}.xlsx`, [
        { name: "B2B", columns: gstColumns, data: register.b2b.map(gstDocument) },
        { name: "B2CL", columns: gstColumns, data: register.b2cl.map(gstDocument) },
        {
          name: "B2CS",
          columns: gstColumns,
          data: register.b2cs.map((row) => ({
            placeOfSupply: row.placeOfSupplyStateCode ?? "",
            rate: row.rateBasisPoints === null ? "" : row.rateBasisPoints / 100,
            ...gstAmounts(row),
          })),
        },
        {
          name: "CDNR",
          columns: [...gstColumns, ...againstColumns],
          data: register.cdnr.map(gstDocument),
        },
        {
          name: "CDNUR",
          columns: [...gstColumns, ...againstColumns],
          data: register.cdnur.map(gstDocument),
        },
        {
          name: "HSN",
          columns: [
            { header: "HSN/SAC", key: "hsnSac", width: 18 },
            { header: "Rate (%)", key: "rate", width: 12 },
            ...gstColumns.slice(6),
          ],
          data: register.hsn.map((row) => ({
            hsnSac: row.hsnSac,
            rate: row.rateBasisPoints / 100,
            ...gstAmounts(row),
          })),
        },
        {
          name: "Exempt",
          columns: [
            { header: "Supply class", key: "supplyClass", width: 20 },
            { header: "Supply", key: "supply", width: 18 },
            ...gstColumns.slice(6),
          ],
          data: register.exempt.map((row) => ({
            supplyClass: row.supplyClass,
            supply: row.intraState ? "Intra-state" : "Inter-state",
            ...gstAmounts(row),
          })),
        },
      ]);
    },
  ),
  gstInwardXlsx: orgProcedure({ export: ["read"] }, periodInput).handler(
    async ({ context, input }) => {
      const rows = await gstRegisterRows(context.scope.orgId, input.from, input.to, "inward");
      const register = buildInwardRegister(rows);

      return xlsxSheets(`gst-inward-${input.from}-${input.to}.xlsx`, [
        {
          name: "Bills",
          columns: [
            ...gstColumns,
            ...againstColumns,
            { header: "Eligible ITC", key: "eligibleItc", width: 16 },
            { header: "Ineligible tax", key: "ineligibleTax", width: 16 },
          ],
          data: register.documents.map((row) => ({
            ...gstDocument(row),
            eligibleItc: money(row.eligibleTaxPaise),
            ineligibleTax: money(row.ineligibleTaxPaise),
          })),
        },
      ]);
    },
  ),
};
