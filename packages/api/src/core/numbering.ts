import type { DbTransaction } from "@accly/db";
import { documents, type DocumentType } from "@accly/db/schema/documents";
import { numberSeries } from "@accly/db/schema/number-series";
import { and, eq, sql } from "drizzle-orm";

import { financialYearStartYear } from "../lib/business-date";
import { badRequest } from "../lib/conflict";

export function financialYearOf(documentDate: string, startMonth: number): string {
  const startYear = financialYearStartYear(documentDate, startMonth);

  if (startMonth === 1) {
    return String(startYear);
  }

  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/**
 * Takes the next `count` consecutive numbers of one series in a single statement. The
 * increment commits or rolls back with the caller's documents, so each series stays
 * consecutive with no gaps; the series row stays locked until the commit.
 */
export async function reserveNumbers(
  tx: DbTransaction,
  orgId: string,
  documentType: DocumentType,
  financialYear: string,
  prefix: string,
  count: number,
): Promise<string[]> {
  const [series] = await tx
    .insert(numberSeries)
    .values({ orgId, documentType, financialYear, prefix, next: count + 1 })
    .onConflictDoUpdate({
      target: [
        numberSeries.orgId,
        numberSeries.documentType,
        numberSeries.financialYear,
        numberSeries.prefix,
      ],
      set: { next: sql`${numberSeries.next} + ${count}` },
    })
    .returning({ next: numberSeries.next });

  if (!series) {
    throw new Error(`Number series update returned no row for ${documentType} ${financialYear}`);
  }

  // `next` is one past the last reserved sequence. "2026-27" prints as "26-27" to keep
  // the number within GST's 16 characters.
  const first = series.next - count;

  const numbers = Array.from(
    { length: count },
    (_, index) => `${prefix}${financialYear.slice(2)}/${first + index}`,
  );

  // GST Rules 46 and 50 cap a number at 16 characters; the last is the longest. The
  // throw rolls the increment back with the documents; a new prefix starts a new series.
  const last = numbers.at(-1);

  if (last !== undefined && last.length > 16) {
    throw badRequest(
      "NUMBER_SERIES_FULL",
      `This number series is full at ${last}. Change the prefix to start a new series.`,
    );
  }

  return numbers;
}

// Numbers and posts a draft. Callers run it last, so the series row lock covers these
// two statements and the commit, not the whole post.
export async function postNumbered(
  tx: DbTransaction,
  orgId: string,
  documentId: string,
  documentType: DocumentType,
  financialYear: string,
  prefix: string,
): Promise<string> {
  const [number] = await reserveNumbers(tx, orgId, documentType, financialYear, prefix, 1);

  if (!number) throw new Error(`No number reserved for ${documentType} ${financialYear}`);

  const [posted] = await tx
    .update(documents)
    .set({ state: "posted", number, postedAt: new Date() })
    .where(
      and(eq(documents.orgId, orgId), eq(documents.id, documentId), eq(documents.state, "draft")),
    )
    .returning({ id: documents.id });

  if (!posted) {
    throw new Error(`Draft ${documentId} was not numbered`);
  }

  return number;
}
