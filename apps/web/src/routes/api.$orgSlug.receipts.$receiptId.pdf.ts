import { createRequestContext } from "@accly/api/lib/context";
import type { AppRouterClient } from "@accly/api/routers/index";
import { appRouter } from "@accly/api/routers/index";
import { contentDisposition } from "@accly/storage/content-disposition";
import { ORPCError, createRouterClient } from "@orpc/server";
import { createFileRoute } from "@tanstack/react-router";

// The guarded receipt query is the route's sole source of tenant data. The renderer
// is lazy so its WASM and fonts stay out of browser and route chunks.
export const Route = createFileRoute("/api/$orgSlug/receipts/$receiptId/pdf")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const client: AppRouterClient = createRouterClient(appRouter, {
          context: () => createRequestContext(new Headers(request.headers)),
        });

        try {
          const data = await client.receipt.get({
            orgSlug: params.orgSlug,
            receiptId: params.receiptId,
          });

          const { renderReceiptPdf } = await import("@/lib/receipt-pdf");
          const { bytes, fileName } = await renderReceiptPdf(data);
          const download = new URL(request.url).searchParams.get("download") === "1";

          return new Response(new Uint8Array(bytes).buffer, {
            headers: {
              "Cache-Control": "private, no-store",
              "Content-Disposition": contentDisposition(
                download ? "attachment" : "inline",
                fileName,
                "document.pdf",
              ),
              "Content-Type": "application/pdf",
            },
          });
        } catch (error) {
          // A 4xx message is written for the user; a 5xx one names internal state.
          if (error instanceof ORPCError && error.status < 500) {
            return new Response(error.message, { status: error.status });
          }

          console.error(error);

          return new Response("Could not render the receipt", { status: 500 });
        }
      },
    },
  },
});
