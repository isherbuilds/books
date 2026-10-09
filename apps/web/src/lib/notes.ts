import type { NOTE_TYPE_LABELS } from "@accly/api/lib/document-labels";
import type { DocumentCursor } from "@accly/api/lib/schemas";
import type { AppRouterClient } from "@accly/api/routers/index";
import type { skipToken } from "@tanstack/react-query";

import { nextPage, orpc } from "@/lib/orpc";

type NoteListFilters = Omit<
  Parameters<AppRouterClient["note"]["list"]>[0],
  "orgSlug" | "cursor" | "limit"
>;

export type NoteListRow = Awaited<ReturnType<AppRouterClient["note"]["list"]>>["rows"][number];

export type NoteDetail = Awaited<ReturnType<AppRouterClient["note"]["get"]>>;

export type NoteSource =
  | Awaited<ReturnType<AppRouterClient["invoice"]["get"]>>
  | Awaited<ReturnType<AppRouterClient["bill"]["get"]>>;

export const noteListOptions = (orgSlug: string, filters: NoteListFilters) =>
  orpc.note.list.infiniteOptions({
    input: (cursor: DocumentCursor | undefined) => ({ orgSlug, ...filters, cursor }),
    ...nextPage,
  });

export const noteDetailOptions = (orgSlug: string, noteId: string) =>
  orpc.note.get.queryOptions({ input: { orgSlug, noteId } });

// The command palette's number/party/reference search over notes.
export const noteSearchOptions = (orgSlug: string, q: string, limit: number) =>
  orpc.note.list.queryOptions({ input: { orgSlug, q, limit } });

// Server-computed totals for an unsaved note; skipped until there is something to quote.
export const noteQuoteOptions = (
  input: Parameters<AppRouterClient["note"]["quote"]>[0] | typeof skipToken,
) => orpc.note.quote.queryOptions({ input });

export type NoteType = keyof typeof NOTE_TYPE_LABELS;
