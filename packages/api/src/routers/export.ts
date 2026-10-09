import { db } from "@accly/db";
import { documents } from "@accly/db/schema/documents";
import { tdsDeductions } from "@accly/db/schema/tds-deductions";
import { tdsSections } from "@accly/db/schema/tds-sections";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { writeXlsx } from "hucre/xlsx";
import { z } from "zod";

import { formatDecimal } from "../core/money";
import { DOCUMENT_TYPE_LABELS } from "../lib/document-labels";
import { buildInwardRegister, buildOutwardRegister, type RegisterLine } from "../core/gst-register";
import type { StatementNode } from "../core/reports";
import { gstRegisterRows } from "../lib/gst-register-rows";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import type { ReportHeader } from "../lib/reports";
import { dateOnly, orderedPeriod } from "../lib/schemas";
import { partyStatement } from "./party";
import {
  accountLedger,
  balanceSheet,
  dayBook,
  dayBookInput,
  ledgerInput,
  periodInput,
  profitAndLoss,
  trialBalance,
} from "./report";

const BOLD_HEADER = { style: { font: { bold: true } } };

// Journal entries also record allocations, which have no document of their own.
const JOURNAL_TYPE_LABELS: Record<string, string> = {
  ...DOCUMENT_TYPE_LABELS,
  allocation: "Amount applied",
};

// ISO dates sort by name in a folder: `tds-register-2026-04-01-to-2026-06-30.xlsx`.
const rangeFileName = (name: string, from: string, to: string) => `${name}-${from}-to-${to}.xlsx`;

type Sheet = Parameters<typeof writeXlsx>[0]["sheets"][number];

async function xlsxSheets(
  fileName: string,
  sheets: (Pick<Sheet, "name"> & {
    columns: NonNullable<Sheet["columns"]>;
    data?: Sheet["data"];
    rows?: Sheet["rows"];
    headerRowIndex?: number;
    totalsRowIndex?: number;
  })[],
): Promise<File> {
  const bytes = await writeXlsx({
    sheets: sheets.map(({ headerRowIndex = 0, totalsRowIndex, ...sheet }) => ({
      ...sheet,
      cells: new Map(
        [
          ...sheet.columns.map((_, index) => `${headerRowIndex},${index}`),
          ...(totalsRowIndex === undefined
            ? []
            : sheet.columns.map((_, index) => `${totalsRowIndex},${index}`)),
        ].map((key) => [key, BOLD_HEADER]),
      ),
    })),
  });

  // SAFETY: hucre 1.1.0 ZipWriter.build allocates new Uint8Array(totalSize), so
  // this unencrypted writeXlsx result has an ArrayBuffer, never SharedArrayBuffer.
  return new File([bytes as Uint8Array<ArrayBuffer>], fileName, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function reportXlsx(
  header: ReportHeader,
  title: string,
  sheetName: string,
  columns: NonNullable<Sheet["columns"]>,
  rows: Array<Record<string, string | number | null>>,
  totals?: Record<string, string | number | null>,
  extraProvenanceRows: string[][] = [],
): Promise<File> {
  const range =
    "asOf" in header.range
      ? `As of ${header.range.asOf}`
      : `${header.range.from} to ${header.range.to}`;

  const format = new Intl.DateTimeFormat("en-GB", {
    timeZone: header.timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  });

  const provenanceRows = [
    [header.organization.legalName],
    [title],
    [range],
    [`Generated ${format.format(header.generatedAt)}`],
    ...extraProvenanceRows,
  ];

  const sheetRows: NonNullable<Sheet["rows"]> = [
    ...provenanceRows,
    columns.map((column) => column.header ?? column.key ?? ""),
    ...rows.map((row) => columns.map((column) => row[column.key ?? ""] ?? null)),
  ];

  if (totals) sheetRows.push(columns.map((column) => totals[column.key ?? ""] ?? null));

  const slug = sheetName.toLowerCase().replaceAll(" ", "-");

  const fileName =
    "asOf" in header.range
      ? `${slug}-${header.range.asOf}.xlsx`
      : rangeFileName(slug, header.range.from, header.range.to);

  return xlsxSheets(fileName, [
    {
      name: sheetName,
      columns,
      rows: sheetRows,
      headerRowIndex: provenanceRows.length,
      totalsRowIndex: totals ? sheetRows.length - 1 : undefined,
    },
  ]);
}

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

function statementRows(
  nodes: StatementNode[],
  depth = 0,
): Array<Record<string, string | number | null>> {
  return nodes.flatMap((node) => [
    {
      code: node.code,
      account: `${"  ".repeat(depth)}${node.name}`,
      amount: money(node.amountPaise),
    },
    ...statementRows(node.children, depth + 1),
  ]);
}

const statementColumns = [
  { header: "Code", key: "code", width: 16 },
  { header: "Account", key: "account", width: 42 },
  { header: "Amount", key: "amount", width: 20 },
];

const dateDocumentColumns = [
  { header: "Date", key: "date", width: 14 },
  { header: "Document", key: "document", width: 20 },
];

const debitCreditColumns = [
  { header: "Debit", key: "debit", width: 18 },
  { header: "Credit", key: "credit", width: 18 },
];

const trialBalanceColumns = [
  { header: "Code", key: "code", width: 14 },
  { header: "Account", key: "account", width: 32 },
  { header: "Group", key: "group", width: 28 },
  { header: "Opening Dr", key: "openingDebit", width: 17 },
  { header: "Opening Cr", key: "openingCredit", width: 17 },
  { header: "Debit", key: "debit", width: 17 },
  { header: "Credit", key: "credit", width: 17 },
  { header: "Closing Dr", key: "closingDebit", width: 17 },
  { header: "Closing Cr", key: "closingCredit", width: 17 },
];

const ledgerColumns = [
  ...dateDocumentColumns,
  { header: "Type", key: "type", width: 18 },
  { header: "Narration", key: "narration", width: 40 },
  { header: "Contra account", key: "contra", width: 26 },
  { header: "Party", key: "party", width: 26 },
  ...debitCreditColumns,
  { header: "Balance (Dr +)", key: "balance", width: 20 },
];

const dayBookColumns = [
  ...dateDocumentColumns,
  { header: "Type", key: "type", width: 18 },
  { header: "Kind", key: "kind", width: 12 },
  { header: "Account code", key: "accountCode", width: 16 },
  { header: "Account", key: "account", width: 30 },
  { header: "Party", key: "party", width: 26 },
  ...debitCreditColumns,
  { header: "Narration", key: "narration", width: 40 },
];

const partyStatementColumns = [
  ...dateDocumentColumns,
  { header: "Type", key: "type", width: 20 },
  { header: "Reference", key: "reference", width: 36 },
  { header: "Amount before TDS", key: "gross", width: 22 },
  { header: "TDS", key: "tds", width: 18 },
  ...debitCreditColumns,
  { header: "Balance (Dr +)", key: "balance", width: 20 },
];

// Excel preserves at most 15 significant digits in numeric cells.
const money = (paise: bigint): number | string =>
  paise > -1_000_000_000_000_000n && paise < 1_000_000_000_000_000n
    ? Number(paise) / 100
    : formatDecimal(paise);

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
  trialBalanceXlsx: orgProcedure(
    { export: ["read"], report: ["readFinancial"] },
    periodInput,
  ).handler(async ({ context, input }) => {
    const { header, rows, totals } = await trialBalance(context.scope.orgId, {
      from: input.from,
      to: input.to,
    });

    return reportXlsx(
      header,
      "Trial balance",
      "Trial balance",
      trialBalanceColumns,
      rows.map((row) => ({
        code: row.code,
        account: row.active ? row.name : `${row.name} (Inactive)`,
        group: row.parentName ?? "",
        openingDebit: money(row.openingDebitPaise),
        openingCredit: money(row.openingCreditPaise),
        debit: money(row.debitPaise),
        credit: money(row.creditPaise),
        closingDebit: money(row.closingDebitPaise),
        closingCredit: money(row.closingCreditPaise),
      })),
      {
        account: "Total",
        openingDebit: money(totals.openingDebitPaise),
        openingCredit: money(totals.openingCreditPaise),
        debit: money(totals.debitPaise),
        credit: money(totals.creditPaise),
        closingDebit: money(totals.closingDebitPaise),
        closingCredit: money(totals.closingCreditPaise),
      },
    );
  }),

  profitAndLossXlsx: orgProcedure(
    { export: ["read"], report: ["readFinancial"] },
    periodInput,
  ).handler(async ({ context, input }) => {
    const { header, income, expenses, incomePaise, expensesPaise, netProfitPaise } =
      await profitAndLoss(context.scope.orgId, { from: input.from, to: input.to });

    return reportXlsx(
      header,
      "Profit and loss",
      "Profit and loss",
      statementColumns,
      [
        { account: "Income", amount: null },
        ...statementRows(income),
        { account: "Total income", amount: money(incomePaise) },
        { account: "Expenses", amount: null },
        ...statementRows(expenses),
        { account: "Total expenses", amount: money(expensesPaise) },
      ],
      { account: "Net profit / loss", amount: money(netProfitPaise) },
    );
  }),
  balanceSheetXlsx: orgProcedure(
    { export: ["read"], report: ["readFinancial"] },
    orgInput.extend({ asOf: dateOnly }),
  ).handler(async ({ context, input }) => {
    const sheet = await balanceSheet(context.scope.orgId, input.asOf);

    return reportXlsx(
      sheet.header,
      "Balance sheet",
      "Balance sheet",
      statementColumns,
      [
        { account: "Assets", amount: null },
        ...statementRows(sheet.assets),
        { account: "Total assets", amount: money(sheet.assetsPaise) },
        { account: "Liabilities", amount: null },
        ...statementRows(sheet.liabilities),
        { account: "Total liabilities", amount: money(sheet.liabilitiesPaise) },
        { account: "Equity", amount: null },
        ...statementRows(sheet.equity),
        {
          account: "Profit and loss, current year",
          amount: money(sheet.currentYearProfitPaise),
        },
        {
          account: "Profit and loss, earlier years",
          amount: money(sheet.earlierYearsProfitPaise),
        },
        { account: "Total equity", amount: money(sheet.equityPaise) },
      ],
      {
        account: "Total liabilities and equity",
        amount: money(sheet.liabilitiesPaise + sheet.equityPaise),
      },
    );
  }),
  accountLedgerXlsx: orgProcedure(
    { export: ["read"], report: ["readFinancial"] },
    ledgerInput,
  ).handler(async ({ context, input }) => {
    const ledger = await accountLedger(context.scope.orgId, input, 100_000);

    return reportXlsx(
      ledger.header,
      `Account ledger - ${ledger.account.code} ${ledger.account.name}`,
      "Account ledger",
      ledgerColumns,
      [
        { narration: "Opening balance", balance: money(ledger.openingPaise) },
        ...ledger.lines.map((line) => ({
          date: line.entryDate,
          document: line.number,
          type: JOURNAL_TYPE_LABELS[line.documentType] ?? line.documentType,
          narration: line.narration,
          contra: line.contraAccountName,
          party: line.partyName,
          debit: money(line.debitPaise),
          credit: money(line.creditPaise),
          balance: money(line.balancePaise),
        })),
      ],
      { narration: "Closing balance", balance: money(ledger.closingPaise) },
    );
  }),
  dayBookXlsx: orgProcedure({ export: ["read"], report: ["readFinancial"] }, dayBookInput).handler(
    async ({ context, input }) => {
      const book = await dayBook(context.scope.orgId, input, 100_000);

      return reportXlsx(
        book.header,
        "Day book",
        "Day book",
        dayBookColumns,
        book.entries.flatMap((entry) =>
          entry.lines.map((line) => ({
            date: entry.entryDate,
            document: entry.number,
            type: JOURNAL_TYPE_LABELS[entry.documentType] ?? entry.documentType,
            kind: entry.kind === "reverse" ? "Cancellation" : "Posted",
            accountCode: line.accountCode,
            account: line.accountName,
            party: line.partyName,
            debit: money(line.debitPaise),
            credit: money(line.creditPaise),
            narration: entry.narration,
          })),
        ),
        {
          account: "Total",
          debit: money(book.debitPaise),
          credit: money(book.creditPaise),
        },
      );
    },
  ),
  partyStatementXlsx: orgProcedure(
    { export: ["read"], party: ["read"], report: ["read"] },
    orgInput
      .extend({ partyId: z.uuid(), from: dateOnly.optional(), to: dateOnly.optional() })
      .superRefine(orderedPeriod),
  ).handler(async ({ context, input }) => {
    const statement = await partyStatement(context.scope.orgId, input, 100_000);

    return reportXlsx(
      statement.header,
      `Party statement - ${statement.party.name}${statement.party.gstin ? ` (${statement.party.gstin})` : ""}`,
      "Party statement",
      partyStatementColumns,
      [
        { type: "Opening balance", balance: money(statement.openingPaise) },
        ...statement.lines.map((line) => ({
          date: line.entryDate,
          document: line.number,
          type: line.kind === "reverse" ? "Cancellation" : line.typeLabel,
          reference: line.reference,
          gross:
            line.tdsPaise === null
              ? null
              : money(
                  (line.amountPaise < 0n ? -line.amountPaise : line.amountPaise) + line.tdsPaise,
                ),
          tds: line.tdsPaise === null ? null : money(line.tdsPaise),
          debit: line.amountPaise > 0n ? money(line.amountPaise) : 0,
          credit: line.amountPaise < 0n ? money(-line.amountPaise) : 0,
          balance: money(line.balancePaise),
        })),
      ],
      { type: "Closing balance", balance: money(statement.closingPaise) },
      [
        ["Party", statement.party.name],
        ["GSTIN", statement.party.gstin ?? ""],
        ["Address", statement.party.address ?? ""],
        ["State code", statement.party.stateCode ?? ""],
      ],
    );
  }),
  tdsRegisterXlsx: orgProcedure({ export: ["read"] }, periodInput).handler(
    async ({ context, input }) => {
      const { orgId } = context.scope;

      // Active deductions and debit-note reversals only. Cancelled documents drop out;
      // a filed quarter is corrected through a Form 140 correction statement.
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
            inArray(documents.type, ["payment", "bill", "debitNote"]),
            eq(documents.state, "posted"),
            gte(documents.documentDate, input.from),
            lte(documents.documentDate, input.to),
          ),
        )
        .orderBy(asc(documents.documentDate), asc(documents.id));

      return xlsxSheets(rangeFileName("tds-register", input.from, input.to), [
        {
          name: "TDS register",
          columns: tdsColumns,
          data: rows.map((row) => ({
            date: row.documentDate,
            document: row.number,
            type: DOCUMENT_TYPE_LABELS[row.type],
            section: row.code,
            rate: row.rateBasisPoints / 100,
            party: row.partyName,
            partyPan: row.partyPan,
            gross: money(row.type === "debitNote" ? -row.basePaise : row.basePaise),
            tds: money(row.type === "debitNote" ? -row.tdsPaise : row.tdsPaise),
            net: money(
              row.type === "debitNote"
                ? -(row.basePaise - row.tdsPaise)
                : row.basePaise - row.tdsPaise,
            ),
          })),
        },
      ]);
    },
  ),
  gstOutwardXlsx: orgProcedure({ export: ["read"] }, periodInput).handler(
    async ({ context, input }) => {
      const { orgId } = context.scope;
      const rows = await gstRegisterRows(orgId, input.from, input.to, "outward");
      const register = buildOutwardRegister(rows);

      return xlsxSheets(rangeFileName("gst-outward", input.from, input.to), [
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

      return xlsxSheets(rangeFileName("gst-inward", input.from, input.to), [
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
