import { invoicePrintTitle } from "@accly/api/core/tax";
import { ORPCError } from "@orpc/server";

import { InvoiceDocument } from "@/components/pdf/invoice-document";
import type { InvoiceDetail } from "@/lib/invoices";
import type { NoteDetail } from "@/lib/notes";
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
    title: `${invoicePrintTitle(data.printClass)} ${data.number} · ${data.printSnapshot.organization.legalName}`,
  });
}

export async function renderNotePdf(
  data: NoteDetail,
): Promise<{ bytes: Uint8Array; fileName: string }> {
  if (data.number === null) {
    throw new ORPCError("NOT_FOUND", { message: "A draft note has no PDF." });
  }

  if (!data.printSnapshot) throw new Error(`Note ${data.number} has no print snapshot`);

  if (!data.against?.number) throw new Error(`Note ${data.number} has no numbered source`);

  const printable = { ...data, number: data.number, printSnapshot: data.printSnapshot };
  const title = data.type === "creditNote" ? "Credit Note" : "Debit Note";

  return renderPdf(<InvoiceDocument data={printable} />, {
    fileName: `${data.number}.pdf`,
    title: `${title} ${data.number} · ${data.printSnapshot.organization.legalName}`,
  });
}
