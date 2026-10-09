import { documentRole } from "@accly/api/core/document-roles";
import { formatMoney, isPositiveMoney } from "@accly/api/core/money";
import { formatBusinessDate } from "@accly/api/lib/business-date";
import { ADJUSTMENT_LABELS } from "@accly/api/lib/document-labels";
import type { PrintSnapshot } from "@accly/db/schema/documents";

import {
  DetailRow,
  PrintedDocument,
  SectionHeading,
  TotalPanel,
  TotalRow,
  colors,
} from "@/components/pdf/parts";
import type { ReceiptDetail } from "@/lib/receipts";

type PrintableReceipt = ReceiptDetail & { number: string; printSnapshot: PrintSnapshot };

export function ReceiptVoucher({ data }: { data: PrintableReceipt }) {
  const { organization, party, paymentMethod, lines } = data.printSnapshot;
  const { refund } = documentRole(data);

  // Adjustment lines always carry a kind; the selected column is typed nullable.
  const adjustments = data.adjustments.flatMap(({ adjustmentKind, ...adjustment }) =>
    adjustmentKind ? [{ ...adjustment, kind: adjustmentKind }] : [],
  );

  return (
    <PrintedDocument
      organization={organization}
      kind="Receipt voucher"
      number={data.number}
      cancelled={data.state === "cancelled"}
    >
      <section>
        <SectionHeading>Receipt details</SectionHeading>
        <div>
          <DetailRow label="Date">{formatBusinessDate(data.documentDate)}</DetailRow>
          {party ? <DetailRow label="Received from">{party.name}</DetailRow> : null}
          {paymentMethod ? <DetailRow label="Payment method">{paymentMethod}</DetailRow> : null}
          <DetailRow label="Towards">{lines.map((line) => line.description).join("; ")}</DetailRow>
          {data.reference ? <DetailRow label="Reference">{data.reference}</DetailRow> : null}
        </div>
      </section>

      {data.allocations.length > 0 ? (
        <section style={{ marginTop: 22 }}>
          <SectionHeading>
            {refund ? "Debit notes and advances refunded" : "Settled documents"}
          </SectionHeading>
          <div
            style={{
              backgroundColor: colors.panel,
              borderBottom: `1px solid ${colors.border}`,
              color: colors.muted,
              display: "flex",
              fontSize: 8,
              fontWeight: 700,
              gap: 8,
              padding: "8px 4px",
            }}
          >
            <span style={{ flex: 2 }}>Number</span>
            <span style={{ flex: 1 }}>Date</span>
            <span style={{ flex: 1, textAlign: "right" }}>Amount applied</span>
          </div>
          {data.allocations.map((allocation) => (
            <div
              key={allocation.id}
              style={{
                borderBottom: `1px solid ${colors.border}`,
                breakInside: "avoid",
                display: "flex",
                fontSize: 8,
                gap: 8,
                padding: "8px 4px",
              }}
            >
              <span style={{ flex: 2 }}>
                {allocation.otherNumber}
                {allocation.reversed ? " (reversed)" : ""}
              </span>
              <span style={{ flex: 1 }}>{formatBusinessDate(allocation.otherDocumentDate)}</span>
              <span style={{ flex: 1, textAlign: "right" }}>
                {formatMoney(allocation.amountPaise)}
              </span>
            </div>
          ))}
        </section>
      ) : null}

      {adjustments.length > 0 ? (
        <section style={{ marginTop: 22 }}>
          <SectionHeading>Adjustments</SectionHeading>
          {adjustments.map((adjustment) => (
            <DetailRow
              key={adjustment.id}
              label={
                adjustment.kind === "tds" && adjustment.sectionCode
                  ? `${ADJUSTMENT_LABELS.tds} (${adjustment.sectionCode})`
                  : ADJUSTMENT_LABELS[adjustment.kind]
              }
            >
              {formatMoney(adjustment.amountPaise)}
            </DetailRow>
          ))}
        </section>
      ) : null}

      <TotalPanel
        label={refund ? "Amount refunded" : "Amount received"}
        amountPaise={data.totalPaise}
      >
        {isPositiveMoney(data.appliedPaise) ? (
          <TotalRow label="Applied" amountPaise={data.appliedPaise} />
        ) : null}
        {adjustments.map((adjustment) => (
          <TotalRow
            key={adjustment.id}
            label={
              adjustment.kind === "tds" && adjustment.sectionCode
                ? `TDS (section ${adjustment.sectionCode})`
                : ADJUSTMENT_LABELS[adjustment.kind]
            }
            amountPaise={-adjustment.amountPaise}
          />
        ))}
        {data.unappliedPaise !== null && isPositiveMoney(data.unappliedPaise) ? (
          <TotalRow label="Received as advance" amountPaise={data.unappliedPaise} />
        ) : null}
      </TotalPanel>

      {data.narration ? (
        <section style={{ marginTop: 22 }}>
          <SectionHeading>Narration</SectionHeading>
          <p style={{ margin: 0 }}>{data.narration}</p>
        </section>
      ) : null}
    </PrintedDocument>
  );
}
