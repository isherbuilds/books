import type { documents } from "@accly/db/schema/documents";
import type { SETTLEMENT_KINDS } from "@accly/db/schema/settlement-kinds";
import { Badge } from "@accly/ui/components/badge";

type DocumentState = (typeof documents.$inferSelect)["state"];

export function struck(state: DocumentState) {
  return state === "cancelled" && "text-muted-foreground line-through";
}

// Only the exception is marked: a posted document carries no badge.
export function CancelledBadge({ state }: { state: DocumentState }) {
  return state === "cancelled" ? <Badge>Cancelled</Badge> : null;
}

export const DOCUMENT_STATE_LABELS = {
  draft: "Draft",
  posted: "Posted",
  cancelled: "Cancelled",
} as const;

/** How a receipt or payment settles: one wording in every filter, form, list and Sheet. */
export const SETTLEMENT_KIND_LABELS = {
  advance: "Advance",
  against: "Against open items",
  direct: "Direct",
} as const satisfies Record<(typeof SETTLEMENT_KINDS)[number], string>;

const SETTLEMENT_LABELS = { paid: "Paid", partPaid: "Part paid", unpaid: "Unpaid" } as const;

// Settled is paid, still due is provisional, part paid stays neutral (design §5).
const SETTLEMENT_TONES = { paid: "settled", partPaid: "neutral", unpaid: "warn" } as const;

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
      <Badge variant={claim.state === "cancelled" ? "neutral" : "warn"}>
        {DOCUMENT_STATE_LABELS[claim.state]}
      </Badge>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <Badge variant={SETTLEMENT_TONES[claim.settlementStatus]}>
        {SETTLEMENT_LABELS[claim.settlementStatus]}
      </Badge>
      {claim.overdue ? <Badge variant="danger">Overdue</Badge> : null}
    </span>
  );
}
