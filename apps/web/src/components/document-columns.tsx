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

export const DOCUMENT_STATE_LABELS = {
  draft: "Draft",
  posted: "Posted",
  cancelled: "Cancelled",
} as const;

const SETTLEMENT_LABELS = { paid: "Paid", partPaid: "Part paid", unpaid: "Unpaid" } as const;

const ALERT = "ring-status-alert-border bg-status-alert-surface text-status-alert";

/** A posted Invoice or Bill shows how far it is settled; a draft or cancelled one, its state. */
export function ClaimStatus({
  claim,
}: {
  claim: {
    state: DocumentState;
    settlementStatus: keyof typeof SETTLEMENT_LABELS;
    overdue: boolean;
  };
}) {
  if (claim.state !== "posted") {
    return (
      <Badge variant={claim.state === "cancelled" ? "muted" : "outline"}>
        {DOCUMENT_STATE_LABELS[claim.state]}
      </Badge>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <Badge
        variant="outline"
        className={
          claim.settlementStatus === "paid"
            ? "ring-status-clear-border bg-status-clear-surface text-status-clear"
            : ALERT
        }
      >
        {SETTLEMENT_LABELS[claim.settlementStatus]}
      </Badge>
      {claim.overdue ? (
        <Badge variant="outline" className={ALERT}>
          Overdue
        </Badge>
      ) : null}
    </span>
  );
}
