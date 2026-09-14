import type { DbTransaction } from "@accly/db";
import { documents, type DocumentType } from "@accly/db/schema/documents";
import { numberSeries } from "@accly/db/schema/number-series";
import { and, eq, sql } from "drizzle-orm";

import { badRequest } from "../lib/conflict";

export function financialYearOf(documentDate: string, startMonth: number): string {
  const year = Number(documentDate.slice(0, 4));
  const month = Number(documentDate.slice(5, 7));

  if (startMonth === 1) {
    return String(year);
  }

  const startYear = month >= startMonth ? year : year - 1;

  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

// Numbers and posts a draft. Callers run it last, so the series row lock covers these
// two statements and the commit, not the whole post. The increment commits or rolls
// back with the document, so each series stays consecutive with no gaps.
export async function postNumbered(
  tx: DbTransaction,
  orgId: string,
  documentId: string,
  documentType: DocumentType,
  financialYear: string,
  prefix: string,
): Promise<string> {
  const [series] = await tx
    .insert(numberSeries)
    .values({ orgId, documentType, financialYear, prefix, next: 2 })
    .onConflictDoUpdate({
      target: [
        numberSeries.orgId,
        numberSeries.documentType,
        numberSeries.financialYear,
        numberSeries.prefix,
      ],
      set: { next: sql`${numberSeries.next} + 1` },
    })
    .returning({ next: numberSeries.next });

  if (!series) {
    throw new Error(`Number series update returned no row for ${documentType} ${financialYear}`);
  }

  // A new row stores 2 and an existing row is incremented, so the sequence is next - 1.
  // "2026-27" prints as "26-27" to keep the number within GST's 16 characters.
  const number = `${prefix}${financialYear.slice(2)}/${series.next - 1}`;

  // GST Rules 46 and 50 cap a number at 16 characters. The throw rolls the increment
  // back with the document; a new prefix starts a new series.
  if (number.length > 16) {
    throw badRequest(
      "NUMBER_SERIES_FULL",
      `This number series is full at ${number}. Change the prefix to start a new series.`,
    );
  }

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
