import { createFileRoute } from "@tanstack/react-router";

import { pdfResponse } from "@/lib/pdf-response";

export const Route = createFileRoute("/api/$orgSlug/invoices/$invoiceId/pdf")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        pdfResponse(request, "invoice", async (client) => {
          const data = await client.invoice.get({
            orgSlug: params.orgSlug,
            invoiceId: params.invoiceId,
          });

          const { renderInvoicePdf } = await import("@/lib/invoice-pdf");

          return renderInvoicePdf(data);
        }),
    },
  },
});
