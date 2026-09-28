import { createFileRoute } from "@tanstack/react-router";

import { pdfResponse } from "@/lib/pdf-response";

export const Route = createFileRoute("/api/$orgSlug/parties/$partyId/statement/pdf")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        pdfResponse(request, "party statement", async (client) => {
          const url = new URL(request.url);
          const from = url.searchParams.get("from");
          const to = url.searchParams.get("to");

          const input: { orgSlug: string; partyId: string; from?: string; to?: string } = {
            orgSlug: params.orgSlug,
            partyId: params.partyId,
          };

          if (from !== null) input.from = from;

          if (to !== null) input.to = to;

          const data = await client.party.statement(input);

          // Keep PDF fonts and WASM out of route and browser chunks until requested.
          const { renderPartyStatementPdf } = await import("@/lib/report-pdf");

          return renderPartyStatementPdf(data);
        }),
    },
  },
});
