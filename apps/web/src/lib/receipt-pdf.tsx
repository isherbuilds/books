import type { ReceiptDetail } from "@accly/api/routers/receipt";

import { ReceiptVoucher } from "@/components/pdf/receipt-voucher";
import { renderPdf } from "@/lib/pdf-render";

export async function renderReceiptPdf(
  data: ReceiptDetail,
): Promise<{ bytes: Uint8Array; fileName: string }> {
  if (!data.number) throw new Error("A receipt PDF requires an assigned receipt number");

  if (!data.printSnapshot) throw new Error("A receipt PDF requires its print snapshot");

  return renderPdf(<ReceiptVoucher data={data} />, {
    fileName: `${data.number}.pdf`,
    title: `Receipt ${data.number} · ${data.printSnapshot.organization.legalName}`,
  });
}
