import { formatBusinessDate } from "@accly/api/lib/business-date";
import type { ReceiptDetail } from "@accly/api/routers/receipt";
import type { PrintSnapshot } from "@accly/db/schema/documents";

import { DetailRow, PrintedDocument, SectionHeading, TotalPanel } from "@/components/pdf/parts";

/** A posted receipt: `renderReceiptPdf` refuses one without a number or snapshot. */
export type PrintableReceipt = ReceiptDetail & { number: string; printSnapshot: PrintSnapshot };

export function ReceiptVoucher({ data }: { data: PrintableReceipt }) {
  const { organization, party, paymentMethod, lines } = data.printSnapshot;

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
          <DetailRow label="Received from">{party?.name ?? "—"}</DetailRow>
          <DetailRow label="Payment method">{paymentMethod ?? "—"}</DetailRow>
          <DetailRow label="Towards">{lines.map((line) => line.description).join("; ")}</DetailRow>
          <DetailRow label="Reference">{data.reference ?? "—"}</DetailRow>
        </div>
      </section>

      <TotalPanel label="Amount received" amountPaise={data.totalPaise} />

      <section style={{ marginTop: 22 }}>
        <SectionHeading>Narration</SectionHeading>
        <p style={{ margin: 0 }}>{data.narration ?? "—"}</p>
      </section>
    </PrintedDocument>
  );
}
