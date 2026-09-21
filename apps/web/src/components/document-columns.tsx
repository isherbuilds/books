import type { documents } from "@accly/db/schema/documents";
import { Badge } from "@accly/ui/components/badge";

type DocumentState = (typeof documents.$inferSelect)["state"];

export function struck(state: DocumentState) {
  return state === "cancelled" && "text-muted-foreground line-through";
}

// Only the exception is marked: a posted document carries no badge.
export function CancelledBadge({ state }: { state: DocumentState }) {
  return state === "cancelled" ? <Badge variant="muted">Cancelled</Badge> : null;
}
