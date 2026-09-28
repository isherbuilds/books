import { createFileRoute } from "@tanstack/react-router";

import { pdfResponse } from "@/lib/pdf-response";

export const Route = createFileRoute("/api/$orgSlug/reports/trial-balance/pdf")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        pdfResponse(request, "trial balance", async (client) => {
          const url = new URL(request.url);

          const data = await client.report.trialBalance({
            orgSlug: params.orgSlug,
            from: url.searchParams.get("from") ?? "",
            to: url.searchParams.get("to") ?? "",
          });

          const { renderTrialBalancePdf } = await import("@/lib/report-pdf");

          return renderTrialBalancePdf(data);
        }),
    },
  },
});
