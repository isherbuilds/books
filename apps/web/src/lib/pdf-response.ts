import { createRequestContext } from "@accly/api/lib/context";
import type { AppRouterClient } from "@accly/api/routers/index";
import { appRouter } from "@accly/api/routers/index";
import { contentDisposition } from "@accly/storage/content-disposition";
import { ORPCError, createRouterClient } from "@orpc/server";

/**
 * Serves a document PDF. The guarded procedure `render` calls is the route's sole
 * source of tenant data; `render` imports its renderer lazily, so the WASM and fonts
 * stay out of browser and route chunks. `?download=1` asks for an attachment.
 */
export async function pdfResponse(
  request: Request,
  noun: string,
  render: (client: AppRouterClient) => Promise<{ bytes: Uint8Array; fileName: string }>,
): Promise<Response> {
  const client: AppRouterClient = createRouterClient(appRouter, {
    context: () => createRequestContext(new Headers(request.headers)),
  });

  try {
    const { bytes, fileName } = await render(client);
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

    return new Response(`Could not render the ${noun}`, { status: 500 });
  }
}
