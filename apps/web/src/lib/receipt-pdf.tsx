import type { ReceiptDetail } from "@accly/api/routers/receipt";

import { ReceiptVoucher } from "@/components/pdf/receipt-voucher";
import { renderPdf } from "@/lib/pdf-render";

export async function renderReceiptPdf(
  data: ReceiptDetail,
): Promise<{ bytes: Uint8Array; fileName: string }> {
  // A receipt posts in one step, so a missing number or snapshot breaks an invariant.
  if (!data.number || !data.printSnapshot) {
    throw new Error(`Receipt ${data.id} has no number or print snapshot`);
  }

  const printable = { ...data, number: data.number, printSnapshot: data.printSnapshot };

  return renderPdf(<ReceiptVoucher data={printable} />, {
    fileName: `${data.number}.pdf`,
    title: `Receipt ${data.number} · ${data.printSnapshot.organization.legalName}`,
  });
}
