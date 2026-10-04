import { createFileRoute } from "@tanstack/react-router";

import { pdfResponse } from "@/lib/pdf-response";

export const Route = createFileRoute("/api/$orgSlug/notes/$noteId/pdf")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        pdfResponse(request, "note", async (client) => {
          const data = await client.note.get({
            orgSlug: params.orgSlug,
            noteId: params.noteId,
          });

          // Keep the PDF WASM and bundled fonts out of browser and route chunks.
          const { renderNotePdf } = await import("@/lib/invoice-pdf");

          return renderNotePdf(data);
        }),
    },
  },
});
