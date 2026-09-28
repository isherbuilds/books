import { createFileRoute } from "@tanstack/react-router";

import { pdfResponse } from "@/lib/pdf-response";

export const Route = createFileRoute("/api/$orgSlug/reports/account-ledger/pdf")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        pdfResponse(request, "account ledger", async (client) => {
          const url = new URL(request.url);

          const data = await client.report.accountLedger({
            orgSlug: params.orgSlug,
            accountId: url.searchParams.get("accountId") ?? "",
            from: url.searchParams.get("from") ?? "",
            to: url.searchParams.get("to") ?? "",
          });

          // Keep PDF fonts and WASM out of route and browser chunks until requested.
          const { renderAccountLedgerPdf } = await import("@/lib/report-pdf");

          return renderAccountLedgerPdf(data);
        }),
    },
  },
});
