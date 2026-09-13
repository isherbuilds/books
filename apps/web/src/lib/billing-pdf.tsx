import { ORPCError } from "@orpc/server";

import {
  CreditNoteDocument,
  type InvoiceBundle,
  InvoiceDocument,
  ReceiptDocument,
  RefundDocument,
} from "@/components/pdf/billing-documents";
import type { BillingDocumentRequest } from "@/lib/billing-document";
import { renderPdf } from "@/lib/pdf-render";

const THERMAL_WIDTH = 302;

function findDocument(data: InvoiceBundle, request: BillingDocumentRequest) {
  switch (request.kind) {
    case "invoice":
      return {
        element: (
          <InvoiceDocument invoice={data.invoice} lines={data.lines} layout={request.layout} />
        ),
        number: data.invoice.invoiceNumber,
        title: "Invoice",
      };
    case "receipt": {
      const payment = data.payments.find((row) => row.id === request.documentId);

      if (!payment) {
        throw new ORPCError("NOT_FOUND", { message: "Receipt not found on this invoice" });
      }

      return {
        element: <ReceiptDocument invoice={data.invoice} payment={payment} />,
        number: payment.receiptNumber,
        title: "Receipt",
      };
    }

    case "credit-note": {
      const note = data.creditNotes.find((row) => row.id === request.documentId);

      if (!note) {
        throw new ORPCError("NOT_FOUND", { message: "Credit note not found on this invoice" });
      }

      return {
        element: (
          <CreditNoteDocument invoice={data.invoice} invoiceLines={data.lines} note={note} />
        ),
        number: note.creditNoteNumber,
        title: "Credit note",
      };
    }

    case "refund": {
      const refund = data.refunds.find((row) => row.id === request.documentId);

      if (!refund) {
        throw new ORPCError("NOT_FOUND", { message: "Refund voucher not found on this invoice" });
      }

      const creditNote = data.creditNotes.find((row) => row.id === refund.creditNoteId);

      if (!creditNote) {
        throw new Error(`Credit note ${refund.creditNoteId} is missing from the invoice bundle`);
      }

      return {
        element: <RefundDocument invoice={data.invoice} refund={refund} creditNote={creditNote} />,
        number: refund.refundNumber,
        title: "Refund voucher",
      };
    }
  }
}

export async function renderBillingPdf(
  request: BillingDocumentRequest & { data: InvoiceBundle },
): Promise<{ bytes: Uint8Array; fileName: string }> {
  const { element, number, title } = findDocument(request.data, request);

  return renderPdf(element, {
    fileName: `${number}.pdf`,
    title: `${title} ${number} · ${request.data.invoice.orgLegalName}`,
    width: request.kind === "invoice" && request.layout === "thermal" ? THERMAL_WIDTH : undefined,
  });
}
