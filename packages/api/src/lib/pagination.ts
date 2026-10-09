import { documents } from "@accly/db/schema/documents";
import { sql, type AnyColumn } from "drizzle-orm";
import type { z } from "zod";

import type { DocumentCursor, ledgerCursor } from "./schemas";

export type LedgerCursor = z.infer<typeof ledgerCursor>;

/**
 * Every list procedure's page. Rows are read with `.limit(limit + 1)`; the extra row
 * only proves a next page exists, and `nextCursor` names it (null at the end), so a
 * client pages with `getNextPageParam: (page) => page.nextCursor ?? undefined`.
 */
export function pageOf<Row, Cursor>(
  rows: Row[],
  limit: number,
  cursorOf: (last: Row) => Cursor,
): { rows: Row[]; nextCursor: Cursor | null } {
  const last = rows[limit - 1];

  if (rows.length <= limit || last === undefined) return { rows, nextCursor: null };

  return { rows: rows.slice(0, limit), nextCursor: cursorOf(last) };
}

/** The cursor of a list in (document date, id) order. */
export const documentCursorOf = (row: { documentDate: string; id: string }): DocumentCursor => ({
  documentDate: row.documentDate,
  id: row.id,
});

/** The cursor of a ledger in (entry date, id) order. */
export const ledgerCursorOf = (row: { entryDate: string; id: string }): LedgerCursor => ({
  entryDate: row.entryDate,
  id: row.id,
});

/**
 * Rows past the cursor in (date, id) order: `after` for the oldest-first pickers and
 * opening items, `before` for the newest-first registers. The cursor carries its own
 * date, so a draft whose date changes between pages cannot skip or repeat rows.
 */
export function dateCursor(cursor: DocumentCursor | undefined, side: "after" | "before") {
  if (!cursor) return undefined;

  const position = sql`(${cursor.documentDate}::date, ${cursor.id})`;

  return side === "after"
    ? sql`(${documents.documentDate}, ${documents.id}) > ${position}`
    : sql`(${documents.documentDate}, ${documents.id}) < ${position}`;
}

// A row comparison, not `a > x OR (a = x AND b > y)`: PostgreSQL seeks the
// (…, entry_date, id) index to the cursor instead of filtering every earlier row.
export const afterCursor = (date: AnyColumn, id: AnyColumn, cursor: LedgerCursor) =>
  sql`(${date}, ${id}) > (${cursor.entryDate}::date, ${cursor.id})`;
