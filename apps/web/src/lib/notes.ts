import type { NOTE_TYPE_LABELS } from "@accly/api/lib/document-labels";
import type { DocumentCursor } from "@accly/api/lib/schemas";
import type { AppRouterClient } from "@accly/api/routers/index";

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

export type NoteType = keyof typeof NOTE_TYPE_LABELS;
