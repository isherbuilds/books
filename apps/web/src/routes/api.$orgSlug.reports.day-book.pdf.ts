import type { DocumentType } from "@accly/db/schema/documents";
import { createFileRoute } from "@tanstack/react-router";

import { pdfResponse } from "@/lib/pdf-response";

export const Route = createFileRoute("/api/$orgSlug/reports/day-book/pdf")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        pdfResponse(request, "day book", async (client) => {
          const url = new URL(request.url);

          // SAFETY: report.dayBook's input schema validates documentType (BAD_REQUEST otherwise).
          const documentType = (url.searchParams.get("documentType") ?? undefined) as
            | DocumentType
            | "allocation"
            | undefined;

          const data = await client.report.dayBook({
            orgSlug: params.orgSlug,
            from: url.searchParams.get("from") ?? "",
            to: url.searchParams.get("to") ?? "",
            documentType,
          });

          // Keep PDF fonts and WASM out of route and browser chunks until requested.
          const { renderDayBookPdf } = await import("@/lib/report-pdf");

          return renderDayBookPdf(data);
        }),
    },
  },
});
