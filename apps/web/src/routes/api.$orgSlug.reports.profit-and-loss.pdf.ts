import { createFileRoute } from "@tanstack/react-router";

import { pdfResponse } from "@/lib/pdf-response";

export const Route = createFileRoute("/api/$orgSlug/reports/profit-and-loss/pdf")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        pdfResponse(request, "profit and loss", async (client) => {
          const url = new URL(request.url);

          const data = await client.report.profitAndLoss({
            orgSlug: params.orgSlug,
            from: url.searchParams.get("from") ?? "",
            to: url.searchParams.get("to") ?? "",
          });

          // Keep PDF fonts and WASM out of route and browser chunks until requested.
          const { renderProfitAndLossPdf } = await import("@/lib/report-pdf");

          return renderProfitAndLossPdf(data);
        }),
    },
  },
});
