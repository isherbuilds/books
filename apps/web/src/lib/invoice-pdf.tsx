import { ORPCError } from "@orpc/server";

import { InvoiceDocument } from "@/components/pdf/invoice-document";
import type { InvoiceDetail } from "@/lib/invoices";
import { renderPdf } from "@/lib/pdf-render";

export async function renderInvoicePdf(
  data: InvoiceDetail,
): Promise<{ bytes: Uint8Array; fileName: string }> {
  // A draft has no number yet, so there is nothing to print.
  if (data.number === null) {
    throw new ORPCError("NOT_FOUND", { message: "A draft invoice has no PDF." });
  }

  if (!data.printSnapshot) throw new Error(`Invoice ${data.number} has no print snapshot`);

  const printable = { ...data, number: data.number, printSnapshot: data.printSnapshot };

  return renderPdf(<InvoiceDocument data={printable} />, {
    fileName: `${data.number}.pdf`,
    title: `Invoice ${data.number} · ${data.printSnapshot.organization.legalName}`,
  });
}
