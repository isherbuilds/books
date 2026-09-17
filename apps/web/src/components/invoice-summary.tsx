import { formatMoney } from "@accly/api/core/money";
import { Badge } from "@accly/ui/components/badge";

import { DetailRow } from "@/components/detail-row";
import type { InvoiceDetail, InvoiceListRow } from "@/lib/invoices";

export const INVOICE_STATE_LABELS = {
  draft: "Draft",
  posted: "Posted",
  cancelled: "Cancelled",
} as const;

const SETTLEMENT_LABELS = { paid: "Paid", partPaid: "Part paid", unpaid: "Unpaid" } as const;

const ALERT = "border-status-alert-border bg-status-alert-surface text-status-alert";

/** A posted invoice shows how far it is settled; a draft or cancelled one shows its state. */
export function InvoiceStatus({
  invoice,
}: {
  invoice: Pick<InvoiceListRow, "state" | "settlementStatus" | "overdue">;
}) {
  if (invoice.state !== "posted") {
    return (
      <Badge variant={invoice.state === "cancelled" ? "muted" : "outline"}>
        {INVOICE_STATE_LABELS[invoice.state]}
      </Badge>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <Badge
        variant="outline"
        className={
          invoice.settlementStatus === "paid"
            ? "border-status-clear-border bg-status-clear-surface text-status-clear"
            : ALERT
        }
      >
        {SETTLEMENT_LABELS[invoice.settlementStatus]}
      </Badge>
      {invoice.overdue ? (
        <Badge variant="outline" className={ALERT}>
          Overdue
        </Badge>
      ) : null}
    </span>
  );
}

/** The server's taxable, tax, round-off and total for a saved invoice. */
export function InvoiceTotals({
  invoice,
}: {
  invoice: Pick<InvoiceDetail, "lines" | "roundOffPaise" | "totalPaise">;
}) {
  let taxablePaise = 0n;
  let taxPaise = 0n;

  for (const line of invoice.lines) {
    taxablePaise += line.amountPaise;
    taxPaise += line.cgstPaise + line.sgstPaise + line.igstPaise;
  }

  return (
    <dl className="grid gap-2">
      <DetailRow label="Taxable">{formatMoney(taxablePaise)}</DetailRow>
      <DetailRow label="Tax">{formatMoney(taxPaise)}</DetailRow>
      <DetailRow label="Round-off">{formatMoney(invoice.roundOffPaise)}</DetailRow>
      <div className="flex items-baseline justify-between gap-4 font-medium">
        <dt>Total</dt>
        <dd className="tabular-nums">{formatMoney(invoice.totalPaise)}</dd>
      </div>
    </dl>
  );
}
