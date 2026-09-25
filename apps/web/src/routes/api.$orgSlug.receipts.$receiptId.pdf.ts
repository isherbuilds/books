import { createFileRoute } from "@tanstack/react-router";

import { pdfResponse } from "@/lib/pdf-response";

export const Route = createFileRoute("/api/$orgSlug/receipts/$receiptId/pdf")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        pdfResponse(request, "receipt", async (client) => {
          const data = await client.receipt.get({
            orgSlug: params.orgSlug,
            receiptId: params.receiptId,
          });

          const { renderReceiptPdf } = await import("@/lib/receipt-pdf");

          return renderReceiptPdf(data);
        }),
    },
  },
});
