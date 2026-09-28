import { createFileRoute } from "@tanstack/react-router";

import { pdfResponse } from "@/lib/pdf-response";

export const Route = createFileRoute("/api/$orgSlug/reports/balance-sheet/pdf")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        pdfResponse(request, "balance sheet", async (client) => {
          const url = new URL(request.url);

          const data = await client.report.balanceSheet({
            orgSlug: params.orgSlug,
            asOf: url.searchParams.get("asOf") ?? "",
          });

          // Keep PDF fonts and WASM out of route and browser chunks until requested.
          const { renderBalanceSheetPdf } = await import("@/lib/report-pdf");

          return renderBalanceSheetPdf(data);
        }),
    },
  },
});
