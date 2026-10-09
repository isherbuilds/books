import type { Sheet } from "hucre";
import { readXlsx, writeXlsx } from "hucre/xlsx";

import { NON_NEGATIVE_MONEY_PATTERN, parseMoney } from "../core/money";
import type { OpeningItem } from "../core/opening-items";
import { badRequest } from "./conflict";
import { FILE_TOO_LARGE_MESSAGE, MAX_IMPORT_FILE_BYTES } from "./import-limits";
import { MASTER_LIST_LIMIT } from "./master-list";
import { normalizedName } from "./normalized-name";
import { dateOnly } from "./schemas";

export const TEMPLATE_VERSION = "1";

type Column = { header: string; required: boolean };

// Sheets in template order; errors sort by this order, then by row.
const SHEETS = {
  "Read me": [],
  Opening: [{ header: "Opening date", required: true }],
  Accounts: [
    { header: "Name", required: true },
    { header: "Parent", required: true },
    { header: "GST supply class", required: false },
  ],
  Parties: [
    { header: "Name", required: true },
    { header: "Roles", required: true },
    { header: "GSTIN", required: false },
    { header: "PAN", required: false },
    { header: "State code", required: false },
    { header: "Address", required: false },
    { header: "City", required: false },
    { header: "PIN code", required: false },
    { header: "Email", required: false },
    { header: "Phone", required: false },
  ],
  Items: [
    { header: "Name", required: true },
    { header: "Income account", required: true },
    { header: "Unit price", required: true },
    { header: "HSN/SAC", required: false },
    { header: "Unit", required: false },
    { header: "Tax code", required: false },
  ],
  "Trial balance": [
    { header: "Account", required: true },
    { header: "Debit", required: false },
    { header: "Credit", required: false },
  ],
  "Opening items": [
    { header: "Party", required: true },
    { header: "Side", required: true },
    { header: "Type", required: true },
    { header: "Reference", required: true },
    { header: "Date", required: true },
    { header: "Due date", required: false },
    { header: "Amount", required: true },
  ],
} as const satisfies Record<string, readonly Column[]>;

export type SheetName = keyof typeof SHEETS;

// SAFETY: string keys keep their declaration order, which is the template order.
export const SHEET_ORDER = Object.keys(SHEETS) as SheetName[];

/** The empty workbook uses exactly the same headers and version as the reader. */
export async function importTemplate(): Promise<File> {
  const bytes = await writeXlsx({
    sheets: SHEET_ORDER.map((name) => ({
      name,
      rows:
        name === "Read me"
          ? [
              ["Template version", TEMPLATE_VERSION],
              ["Create masters and, optionally, import the trial balance and party opening items."],
              [
                "Use the headers on row 1. Paste values only; amounts are rupees and dates are YYYY-MM-DD.",
              ],
              [
                "Parent: an active group's code or name, or Assets, Liabilities, Equity, Income, Expenses.",
              ],
              ["Roles: comma-separated customer, vendor, tenant, donor, employee, government."],
              ["GST supply class: taxable, exempt, nil, nonGst, notASupply."],
              [
                "Tax code: taxable items use your organization's GST rate codes (GST5, GST12, GST18, GST28, GST40); check which rates are effective in Items.",
              ],
            ]
          : [SHEETS[name].map((column) => column.header)],
    })),
  });

  // SAFETY: writeXlsx allocates a Uint8Array backed by an ArrayBuffer.
  return new File([bytes as Uint8Array<ArrayBuffer>], "import-template.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export type ImportError = {
  sheet: SheetName | null;
  row: number | null;
  column: string | null;
  code: string;
  message: string;
};

type TrialBalanceRow = { row: number; account: string; debitPaise: bigint; creditPaise: bigint };

type OpeningItemRow = {
  row: number;
  party: string;
  side: OpeningItem["side"];
  type: OpeningItem["type"];
  reference: string;
  documentDate: string;
  dueDate: string | null;
  amountPaise: bigint;
};

type AccountRow = { row: number; name: string; parent: string; supplyClass?: string };

type PartyRow = {
  row: number;
  name: string;
  roles: string[];
  gstin?: string;
  pan?: string;
  stateCode?: string;
  address?: string;
  city?: string;
  pinCode?: string;
  email?: string;
  phone?: string;
};

type ItemRow = {
  row: number;
  name: string;
  incomeAccount: string;
  unitPricePaise: bigint;
  hsnSac?: string;
  unit?: string;
  taxCode?: string;
};

export type ImportWorkbook = {
  openingDate: string | null;
  accounts: AccountRow[];
  parties: PartyRow[];
  items: ItemRow[];
  trialBalance: TrialBalanceRow[];
  openingItems: OpeningItemRow[];
};

type CellValue = string | number | boolean | Date | null;

/** One data row's non-blank cells by header, with its Excel row number. */
type DataRow = { row: number; cells: Map<string, CellValue> };

// Longer than any template field; the master schemas own each field's own limit.
const CELL_MAX = 500;

class SheetReader {
  readonly errors: ImportError[] = [];

  error(
    sheet: SheetName | null,
    row: number | null,
    column: string | null,
    code: string,
    message: string,
  ) {
    this.errors.push({ sheet, row, column, code, message });
  }

  /** The cell's value; a blank cell in a required column is an error. */
  private cell(sheet: SheetName, row: DataRow, column: string): CellValue {
    const value = row.cells.get(column) ?? null;
    const columns: readonly Column[] = SHEETS[sheet];

    if (value === null && columns.some((entry) => entry.header === column && entry.required))
      this.error(sheet, row.row, column, "CELL_REQUIRED", `Enter ${column}.`);

    return value;
  }

  text(sheet: SheetName, row: DataRow, column: string, max = CELL_MAX): string | null {
    const value = this.cell(sheet, row, column);

    if (value === null) return null;

    const text =
      typeof value === "string"
        ? value.trim()
        : typeof value === "number" && Number.isInteger(value)
          ? String(value)
          : null;

    if (text === null || text.length > max) {
      this.error(
        sheet,
        row.row,
        column,
        "CELL_INVALID",
        `Enter text of at most ${max} characters.`,
      );

      return null;
    }

    return text;
  }

  money(sheet: SheetName, row: DataRow, column: string): bigint | null {
    const value = this.cell(sheet, row, column);

    if (value === null) return null;

    if (typeof value === "number") {
      const scaled = value * 100;
      const paise = Math.round(scaled);

      // A third decimal is at least 0.1 paise off, and float noise stays under 0.01
      // paise below thousands of crores; a larger amount is refused, never rounded.
      // Below 1e15 paise matches the text pattern's 13 rupee digits, so 5,000 rows
      // cannot overflow a bigint total.
      if (value >= 0 && paise < 1e15 && Math.abs(scaled - paise) < 0.01) return BigInt(paise);
    } else if (typeof value === "string" && NON_NEGATIVE_MONEY_PATTERN.test(value.trim())) {
      return parseMoney(value.trim());
    }

    this.error(
      sheet,
      row.row,
      column,
      "AMOUNT_INVALID",
      "Enter a non-negative amount with two decimal places at most and no thousands separator.",
    );

    return null;
  }

  date(sheet: SheetName, row: DataRow, column: string): string | null {
    const value = this.cell(sheet, row, column);

    if (value === null) return null;

    const text =
      value instanceof Date
        ? Number.isNaN(value.getTime())
          ? null
          : value.toISOString().slice(0, 10)
        : typeof value === "string"
          ? value.trim()
          : null;

    if (text === null || !dateOnly.safeParse(text).success) {
      this.error(sheet, row.row, column, "DATE_INVALID", "Enter a date as YYYY-MM-DD.");

      return null;
    }

    return text;
  }
}

/** Reads the template's sheets: header names on row 1, data from row 2. */
export async function readImportWorkbook(
  file: File,
): Promise<{ workbook: ImportWorkbook; errors: ImportError[] }> {
  if (file.size > MAX_IMPORT_FILE_BYTES) throw badRequest("FILE_TOO_LARGE", FILE_TOO_LARGE_MESSAGE);

  const reader = new SheetReader();

  const workbook: ImportWorkbook = {
    openingDate: null,
    accounts: [],
    parties: [],
    items: [],
    trialBalance: [],
    openingItems: [],
  };

  // Dense parsing allocates the cell rectangle before checking its size. Sparse
  // parsing keeps only cells, so a distant coordinate cannot allocate a huge grid.
  const parsed = await readXlsx(new Uint8Array(await file.arrayBuffer()), {
    sparse: true,
    maxDecompressedBytes: 20 * 1024 * 1024,
  }).catch(() => {
    throw badRequest("WORKBOOK_INVALID", "Choose an .xlsx workbook made from the import template.");
  });

  const rowsBySheet = new Map<SheetName, DataRow[]>();

  for (const sheet of parsed.sheets) {
    if (!Object.hasOwn(SHEETS, sheet.name)) {
      reader.error(null, null, null, "SHEET_UNKNOWN", `Remove the sheet "${sheet.name}".`);
      continue;
    }

    // SAFETY: the own-property check above admits only template sheet names.
    const name = sheet.name as SheetName;

    if (rowsBySheet.has(name)) {
      reader.error(name, null, null, "SHEET_REPEATED", `The sheet "${name}" appears twice.`);
      continue;
    }

    // Only a cell's detail record carries its type; plain values have none.
    for (const [key, cell] of sheet.cells ?? []) {
      if (cell.type === "formula" || cell.type === "error" || cell.type === "richText") {
        const [row, column] = key.split(",").map(Number);
        reader.error(
          name,
          row! + 1,
          String(sheet.cells?.get(`0,${column}`)?.value ?? column! + 1),
          "CELL_INVALID",
          "Paste values only: no formulas, errors or formatted text.",
        );

        cell.value = null;
      }
    }

    if (name === "Read me") {
      const version = sheet.cells?.get("0,1")?.value ?? null;

      if (version === null || String(version).trim() !== TEMPLATE_VERSION)
        reader.error(
          name,
          1,
          "B",
          "TEMPLATE_VERSION",
          `Use template version ${TEMPLATE_VERSION}: download the import template again.`,
        );

      rowsBySheet.set(name, []);
      continue;
    }

    rowsBySheet.set(name, dataRows(reader, name, sheet));
  }

  if (!rowsBySheet.has("Read me"))
    reader.error(
      "Read me",
      null,
      null,
      "TEMPLATE_VERSION",
      "Use the import template: its Read me sheet is missing.",
    );

  const opening = rowsBySheet.get("Opening") ?? [];

  if (opening.length > 1)
    reader.error("Opening", opening[1]!.row, null, "ROW_EXTRA", "Enter one opening date only.");

  const [openingRow] = opening;

  if (openingRow) workbook.openingDate = reader.date("Opening", openingRow, "Opening date");

  for (const row of rowsBySheet.get("Accounts") ?? []) {
    const name = reader.text("Accounts", row, "Name");
    const parent = reader.text("Accounts", row, "Parent");
    const supplyClass = reader.text("Accounts", row, "GST supply class") ?? undefined;

    if (name !== null && parent !== null)
      workbook.accounts.push({ row: row.row, name, parent, supplyClass });
  }

  for (const row of rowsBySheet.get("Parties") ?? []) {
    const name = reader.text("Parties", row, "Name");
    const roles = reader.text("Parties", row, "Roles");

    const fields = {
      gstin: reader.text("Parties", row, "GSTIN") ?? undefined,
      pan: reader.text("Parties", row, "PAN") ?? undefined,
      // Excel stores a typed 07 as the number 7; no state code has one digit.
      stateCode: reader.text("Parties", row, "State code")?.padStart(2, "0") ?? undefined,
      address: reader.text("Parties", row, "Address") ?? undefined,
      city: reader.text("Parties", row, "City") ?? undefined,
      pinCode: reader.text("Parties", row, "PIN code") ?? undefined,
      email: reader.text("Parties", row, "Email") ?? undefined,
      phone: reader.text("Parties", row, "Phone") ?? undefined,
    };

    if (name !== null && roles !== null)
      workbook.parties.push({
        row: row.row,
        name,
        roles: roles.split(",").map((role) => role.trim().toLowerCase()),
        ...fields,
      });
  }

  for (const row of rowsBySheet.get("Items") ?? []) {
    const name = reader.text("Items", row, "Name");
    const incomeAccount = reader.text("Items", row, "Income account");
    const unitPricePaise = reader.money("Items", row, "Unit price");

    const fields = {
      hsnSac: reader.text("Items", row, "HSN/SAC") ?? undefined,
      unit: reader.text("Items", row, "Unit") ?? undefined,
      taxCode: reader.text("Items", row, "Tax code") ?? undefined,
    };

    if (name !== null && incomeAccount !== null && unitPricePaise !== null)
      workbook.items.push({ row: row.row, name, incomeAccount, unitPricePaise, ...fields });
  }

  for (const row of rowsBySheet.get("Trial balance") ?? []) {
    const account = reader.text("Trial balance", row, "Account");
    const debit = reader.money("Trial balance", row, "Debit");
    const credit = reader.money("Trial balance", row, "Credit");

    // A malformed amount already has its error.
    const malformed =
      (debit === null && row.cells.has("Debit")) || (credit === null && row.cells.has("Credit"));

    if (account === null || malformed) continue;

    if ((debit ?? 0n) > 0n === (credit ?? 0n) > 0n) {
      reader.error(
        "Trial balance",
        row.row,
        "Debit",
        "AMOUNT_INVALID",
        "Enter one amount above zero: a debit or a credit.",
      );
      continue;
    }

    workbook.trialBalance.push({
      row: row.row,
      account,
      debitPaise: debit ?? 0n,
      creditPaise: credit ?? 0n,
    });
  }

  const itemKeys = new Set<string>();

  for (const row of rowsBySheet.get("Opening items") ?? []) {
    const party = reader.text("Opening items", row, "Party");
    const side = choice(reader, row, "Side", { receivable: "receivable", payable: "payable" });
    const type = choice(reader, row, "Type", { claim: "openingClaim", credit: "openingCredit" });
    const reference = reader.text("Opening items", row, "Reference", 40);
    const documentDate = reader.date("Opening items", row, "Date");
    const dueDate = reader.date("Opening items", row, "Due date");
    const amount = reader.money("Opening items", row, "Amount");

    if (!party || !side || !type || !reference || !documentDate || amount === null) continue;

    if (amount === 0n) {
      reader.error(
        "Opening items",
        row.row,
        "Amount",
        "AMOUNT_INVALID",
        "Enter an amount above zero.",
      );
      continue;
    }

    if (dueDate !== null && type === "openingCredit") {
      reader.error(
        "Opening items",
        row.row,
        "Due date",
        "DUE_DATE_INVALID",
        "Only a claim has a due date.",
      );
      continue;
    }

    if (dueDate !== null && dueDate < documentDate) {
      reader.error(
        "Opening items",
        row.row,
        "Due date",
        "DUE_DATE_INVALID",
        "Enter a due date on or after the date.",
      );
      continue;
    }

    const key = [normalizedName(party), side, type, reference.toLowerCase()].join("\u0000");

    if (itemKeys.has(key)) {
      reader.error(
        "Opening items",
        row.row,
        "Reference",
        "ITEM_REPEATED",
        `${reference} is already listed for ${party} on this side.`,
      );
      continue;
    }

    itemKeys.add(key);
    workbook.openingItems.push({
      row: row.row,
      party,
      side,
      type,
      reference,
      documentDate,
      dueDate,
      amountPaise: amount,
    });
  }

  return { workbook, errors: reader.errors };
}

function choice<T extends string>(
  reader: SheetReader,
  row: DataRow,
  column: string,
  options: Record<string, T>,
): T | null {
  const text = reader.text("Opening items", row, column);

  if (text === null) return null;

  const key = text.toLowerCase();
  const value = Object.hasOwn(options, key) ? options[key] : undefined;

  if (value === undefined) {
    const labels = Object.keys(options).map((key) => key[0]!.toUpperCase() + key.slice(1));
    reader.error("Opening items", row.row, column, "CELL_INVALID", `Enter ${labels.join(" or ")}.`);

    return null;
  }

  return value;
}

/** A sheet's data rows keyed by header, skipping rows with every cell blank. */
function dataRows(reader: SheetReader, sheet: SheetName, source: Sheet): DataRow[] {
  const columns: readonly Column[] = SHEETS[sheet];
  const headers = new Map<number, string>();
  const seen = new Set<string>();

  for (const [key, cell] of source.cells ?? []) {
    const [row, column] = key.split(",").map(Number);

    if (row !== 0) continue;
    const name = typeof cell.value === "string" ? cell.value.trim() : null;

    if (name === null || name === "") continue;

    if (!columns.some((column) => column.header === name))
      reader.error(sheet, 1, name, "HEADER_UNKNOWN", `Remove the column "${name}".`);
    else if (seen.has(name))
      reader.error(sheet, 1, name, "HEADER_REPEATED", `The column "${name}" appears twice.`);

    seen.add(name);
    headers.set(column!, name);
  }

  for (const column of columns)
    if (column.required && !seen.has(column.header))
      reader.error(sheet, 1, column.header, "HEADER_MISSING", `Add the column "${column.header}".`);

  const rows = new Map<number, DataRow>();

  for (const [key, { value }] of source.cells ?? []) {
    const [row, column] = key.split(",").map(Number);

    if (row === 0 || value === null || (typeof value === "string" && value.trim() === "")) continue;

    if (row! > MASTER_LIST_LIMIT) {
      reader.error(
        sheet,
        null,
        null,
        "SHEET_TOO_LARGE",
        `A sheet holds at most ${MASTER_LIST_LIMIT.toLocaleString("en-IN")} rows.`,
      );

      return [];
    }

    const header = headers.get(column!);

    if (!header) {
      reader.error(
        sheet,
        row! + 1,
        String(column! + 1),
        "HEADER_MISSING",
        "This column has data but no template header.",
      );
      continue;
    }

    const dataRow = rows.get(row!) ?? { row: row! + 1, cells: new Map<string, CellValue>() };
    dataRow.cells.set(header, value);
    rows.set(row!, dataRow);
  }

  return [...rows.values()].sort((a, b) => a.row - b.row);
}
