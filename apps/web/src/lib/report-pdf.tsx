import { creditOf, debitOf, formatBalance, formatMoney, isZeroMoney } from "@accly/api/core/money";
import type {
  AccountLedgerReport,
  BalanceSheetReport,
  DayBookReport,
  ProfitAndLossReport,
  StatementNode,
  TrialBalanceRow,
  TrialBalanceTotals,
} from "@accly/api/core/reports";
import { formatBusinessDate } from "@accly/api/lib/business-date";
import type { ReportHeader } from "@accly/api/lib/reports";
import type { PartyStatementReport } from "@accly/api/routers/party";

import { colors } from "@/components/pdf/parts";
import { formatDateTime } from "@/lib/org-datetime";
import { renderPdf } from "@/lib/pdf-render";
import { formatSideBalance } from "@/lib/reports";

type PdfColumn = { label: string; width: string; align?: "left" | "right" };

type PdfRow = { cells: string[]; strong?: boolean; indent?: number; indentColumn?: number };

type ReportPdfProps = {
  header: ReportHeader;
  title: string;
  slug: string;
  columns: PdfColumn[];
  rows: PdfRow[];
  detail?: { label: string; value: string }[];
};

function reportHeading({ header, title, columns, detail }: ReportPdfProps) {
  const range =
    "asOf" in header.range
      ? `As of ${formatBusinessDate(header.range.asOf)}`
      : `${formatBusinessDate(header.range.from)} – ${formatBusinessDate(header.range.to)}`;

  return (
    <div style={{ color: colors.ink, padding: "0 44px 8px", width: "100%" }}>
      <div style={{ borderBottom: `2px solid ${colors.ink}`, paddingBottom: 8 }}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>{header.organization.legalName}</div>
        {header.organization.gstin ? (
          <div style={{ color: colors.muted, fontSize: 8 }}>GSTIN {header.organization.gstin}</div>
        ) : null}
        <div style={{ fontSize: 12, fontWeight: 700, marginTop: 8 }}>{title}</div>
        <div style={{ fontSize: 9, marginTop: 3 }}>{range}</div>
        <div style={{ color: colors.muted, fontSize: 8, marginTop: 3 }}>
          Generated {formatDateTime(header.generatedAt, header.timeZone)} · period not closed
        </div>
        {detail?.length ? (
          <div style={{ fontSize: 8, marginTop: 8 }}>
            {detail.map(({ label, value }) => (
              <div key={label} style={{ marginTop: 2 }}>
                <span style={{ color: colors.muted }}>{label}: </span>
                {value}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div style={{ backgroundColor: colors.panel, display: "flex", padding: "7px 0" }}>
        {columns.map((column) => (
          <span
            key={column.label}
            style={{
              color: colors.muted,
              fontSize: 8,
              fontWeight: 700,
              textAlign: column.align ?? "left",
              width: column.width,
            }}
          >
            {column.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function ReportPdf({ rows, columns }: ReportPdfProps) {
  return (
    <main style={{ color: colors.ink }}>
      {rows.map((row, index) => (
        <div
          key={index}
          style={{
            borderBottom: `1px solid ${colors.border}`,
            display: "flex",
            fontSize: 8,
            fontWeight: row.strong ? 700 : 400,
            padding: "7px 0",
          }}
        >
          {row.cells.map((cell, cellIndex) => (
            <span
              key={cellIndex}
              style={{
                overflowWrap: "anywhere",
                paddingLeft: cellIndex === (row.indentColumn ?? 0) ? (row.indent ?? 0) * 12 : 0,
                textAlign: columns[cellIndex].align ?? "left",
                whiteSpace: "pre-line",
                width: columns[cellIndex].width,
              }}
            >
              {cell}
            </span>
          ))}
        </div>
      ))}
    </main>
  );
}

function renderReportPdf(data: ReportPdfProps): Promise<{ bytes: Uint8Array; fileName: string }> {
  const { header, title, slug } = data;

  const suffix =
    "asOf" in header.range ? header.range.asOf : `${header.range.from}-${header.range.to}`;

  return renderPdf(<ReportPdf {...data} />, {
    fileName: `${slug}-${suffix}.pdf`,
    title: `${title} · ${header.organization.legalName}`,
    header: reportHeading(data),
  });
}

function treeRows(nodes: StatementNode[], indent = 0): PdfRow[] {
  return nodes.flatMap((node) => [
    {
      cells: [node.code, node.name, formatMoney(node.amountPaise)],
      strong: node.children.length > 0,
      indent,
      indentColumn: 1,
    },
    ...treeRows(node.children, indent + 1),
  ]);
}

const statementColumns: PdfColumn[] = [
  { label: "Code", width: "15%" },
  { label: "Account", width: "60%" },
  { label: "Amount", width: "25%", align: "right" },
];

function statementSection(title: string, nodes: StatementNode[], amountPaise: bigint): PdfRow[] {
  return [
    { cells: ["", title, formatMoney(amountPaise)], strong: true },
    ...treeRows(nodes),
    { cells: ["", `Total ${title.toLowerCase()}`, formatMoney(amountPaise)], strong: true },
  ];
}

export function renderTrialBalancePdf(data: {
  header: ReportHeader;
  rows: TrialBalanceRow[];
  totals: TrialBalanceTotals;
}) {
  const { totals } = data;

  return renderReportPdf({
    header: data.header,
    title: "Trial balance",
    slug: "trial-balance",
    columns: [
      { label: "Code", width: "10%" },
      { label: "Account", width: "30%" },
      { label: "Opening", width: "15%", align: "right" },
      { label: "Debit", width: "15%", align: "right" },
      { label: "Credit", width: "15%", align: "right" },
      { label: "Closing", width: "15%", align: "right" },
    ],
    rows: [
      ...data.rows.map((row) => ({
        cells: [
          row.code,
          `${row.name}${row.active ? "" : " (Inactive)"}${row.parentName ? ` · ${row.parentName}` : ""}`,
          formatSideBalance(row.openingDebitPaise, row.openingCreditPaise),
          formatMoney(row.debitPaise),
          formatMoney(row.creditPaise),
          formatSideBalance(row.closingDebitPaise, row.closingCreditPaise),
        ],
      })),
      {
        cells: [
          "",
          "Totals",
          `${formatMoney(totals.openingDebitPaise)} Dr\n${formatMoney(totals.openingCreditPaise)} Cr`,
          formatMoney(totals.debitPaise),
          formatMoney(totals.creditPaise),
          `${formatMoney(totals.closingDebitPaise)} Dr\n${formatMoney(totals.closingCreditPaise)} Cr`,
        ],
        strong: true,
      },
    ],
  });
}

export function renderProfitAndLossPdf(data: ProfitAndLossReport) {
  return renderReportPdf({
    header: data.header,
    title: "Profit and loss",
    slug: "profit-and-loss",
    columns: statementColumns,
    rows: [
      ...statementSection("Income", data.income, data.incomePaise),
      ...statementSection("Expenses", data.expenses, data.expensesPaise),
      { cells: ["", "Net profit / (loss)", formatMoney(data.netProfitPaise)], strong: true },
    ],
  });
}

export function renderBalanceSheetPdf(data: BalanceSheetReport) {
  return renderReportPdf({
    header: data.header,
    title: "Balance sheet",
    slug: "balance-sheet",
    columns: statementColumns,
    rows: [
      ...statementSection("Assets", data.assets, data.assetsPaise),
      ...statementSection("Liabilities", data.liabilities, data.liabilitiesPaise),
      { cells: ["", "Equity", formatMoney(data.equityPaise)], strong: true },
      ...treeRows(data.equity),
      { cells: ["", "Profit and loss, current year", formatMoney(data.currentYearProfitPaise)] },
      { cells: ["", "Profit and loss, earlier years", formatMoney(data.earlierYearsProfitPaise)] },
      { cells: ["", "Total equity", formatMoney(data.equityPaise)], strong: true },
      {
        cells: [
          "",
          "Total liabilities and equity",
          formatMoney(data.liabilitiesPaise + data.equityPaise),
        ],
        strong: true,
      },
    ],
  });
}

export function renderAccountLedgerPdf(data: AccountLedgerReport) {
  return renderReportPdf({
    header: data.header,
    title: `Account ledger · ${data.account.code} ${data.account.name}${data.account.active ? "" : " (Inactive)"}`,
    slug: `account-ledger-${data.account.code}`,
    columns: [
      { label: "Date", width: "12%" },
      { label: "Document", width: "16%" },
      { label: "Particulars", width: "27%" },
      { label: "Debit", width: "15%", align: "right" },
      { label: "Credit", width: "15%", align: "right" },
      { label: "Balance", width: "15%", align: "right" },
    ],
    rows: [
      { cells: ["", "", "Opening", "", "", formatBalance(data.openingPaise)], strong: true },
      ...data.lines.map((line) => ({
        cells: [
          formatBusinessDate(line.entryDate),
          line.number ?? "Allocation",
          `${line.narration}${line.partyName ? ` · ${line.partyName}` : ""}`,
          line.debitPaise ? formatMoney(line.debitPaise) : "",
          line.creditPaise ? formatMoney(line.creditPaise) : "",
          formatBalance(line.balancePaise),
        ],
      })),
      { cells: ["", "", "Closing", "", "", formatBalance(data.closingPaise)], strong: true },
    ],
  });
}

export function renderDayBookPdf(data: DayBookReport) {
  return renderReportPdf({
    header: data.header,
    title: "Day book",
    slug: "day-book",
    columns: [
      { label: "Date", width: "12%" },
      { label: "Document", width: "16%" },
      { label: "Account / particulars", width: "42%" },
      { label: "Debit", width: "15%", align: "right" },
      { label: "Credit", width: "15%", align: "right" },
    ],
    rows: [
      ...data.entries.flatMap((entry) => [
        {
          cells: [
            formatBusinessDate(entry.entryDate),
            entry.number ?? "Allocation",
            entry.narration,
            "",
            "",
          ],
          strong: true,
        },
        ...entry.lines.map((line) => ({
          cells: [
            "",
            "",
            `${line.accountCode} ${line.accountName}${line.partyName ? ` · ${line.partyName}` : ""}`,
            line.debitPaise ? formatMoney(line.debitPaise) : "",
            line.creditPaise ? formatMoney(line.creditPaise) : "",
          ],
          indent: 1,
          indentColumn: 2,
        })),
      ]),
      {
        cells: ["", "", "Totals", formatMoney(data.debitPaise), formatMoney(data.creditPaise)],
        strong: true,
      },
    ],
  });
}

export function renderPartyStatementPdf(data: PartyStatementReport) {
  return renderReportPdf({
    header: data.header,
    title: "Party statement",
    slug: "party-statement",
    detail: [
      { label: "Party", value: data.party.name },
      ...(data.party.gstin ? [{ label: "GSTIN", value: data.party.gstin }] : []),
      ...(data.party.address ? [{ label: "Address", value: data.party.address }] : []),
      ...(data.party.stateCode ? [{ label: "State code", value: data.party.stateCode }] : []),
    ],
    columns: [
      { label: "Date", width: "14%" },
      { label: "Document", width: "18%" },
      { label: "Particulars", width: "23%" },
      { label: "Debit", width: "15%", align: "right" },
      { label: "Credit", width: "15%", align: "right" },
      { label: "Balance", width: "15%", align: "right" },
    ],
    rows: [
      { cells: ["", "", "Opening", "", "", formatBalance(data.openingPaise)], strong: true },
      ...data.lines.map((line) => {
        const debit = debitOf(line.amountPaise);
        const credit = creditOf(line.amountPaise);

        return {
          cells: [
            formatBusinessDate(line.entryDate),
            line.number ?? "—",
            `${line.kind === "reverse" ? "Cancellation" : line.typeLabel}${line.reference ? ` · ${line.reference}` : ""}`,
            isZeroMoney(debit) ? "" : formatMoney(debit),
            isZeroMoney(credit) ? "" : formatMoney(credit),
            formatBalance(line.balancePaise),
          ],
        };
      }),
      { cells: ["", "", "Closing", "", "", formatBalance(data.closingPaise)], strong: true },
    ],
  });
}
