import type { DbTransaction } from "@accly/db/counter";
import { numberSeries } from "@accly/db/schema/number-series";
import type { DocumentType } from "@accly/db/schema/documents";
import { sql } from "drizzle-orm";

const DOCUMENT_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDocumentDate(documentDate: string): { year: number; month: number } {
  const match = DOCUMENT_DATE_PATTERN.exec(documentDate);

  if (!match) {
    throw new Error(`Invalid document date: ${documentDate}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const daysInMonth = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]!) {
    throw new Error(`Invalid document date: ${documentDate}`);
  }

  return { year, month };
}

export function financialYearOf(documentDate: string, startMonth: number): string {
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new Error(`Invalid financial year start month: ${startMonth}`);
  }

  const { year, month } = parseDocumentDate(documentDate);

  if (startMonth === 1) {
    return String(year);
  }

  const startYear = month >= startMonth ? year : year - 1;

  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export function formatDocumentNumber(
  prefix: string,
  financialYear: string,
  sequence: number,
): string {
  return `${prefix}${financialYear}/${sequence}`;
}

export function monthOf(documentDate: string): string {
  parseDocumentDate(documentDate);

  return `${documentDate.slice(0, 7)}-01`;
}

export async function assignNumber(
  tx: DbTransaction,
  orgId: string,
  documentType: DocumentType,
  financialYear: string,
  prefix: string,
): Promise<string> {
  const [series] = await tx
    .insert(numberSeries)
    .values({ orgId, documentType, financialYear, prefix, next: 2 })
    .onConflictDoUpdate({
      target: [numberSeries.orgId, numberSeries.documentType, numberSeries.financialYear],
      set: { next: sql`${numberSeries.next} + 1` },
    })
    .returning({ next: numberSeries.next });

  if (!series) {
    throw new Error(`Number series update returned no row for ${documentType} ${financialYear}`);
  }

  // A new row stores the next available value (2), while an existing row is
  // incremented under its row lock. In both cases the assigned sequence is next - 1.
  return formatDocumentNumber(prefix, financialYear, series.next - 1);
}
