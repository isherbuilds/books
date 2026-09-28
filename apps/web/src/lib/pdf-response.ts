import { createRequestContext } from "@accly/api/lib/context";
import type { AppRouterClient } from "@accly/api/routers/index";
import { appRouter } from "@accly/api/routers/index";
import { contentDisposition } from "@accly/storage/content-disposition";
import { ORPCError, createRouterClient } from "@orpc/server";

/**
 * Serves a document PDF. The guarded procedure `render` calls is the route's sole
 * source of tenant data; `render` imports its renderer lazily, so the WASM and fonts
 * stay out of browser and route chunks. It opens inline; the viewer saves it.
 */
export async function pdfResponse(
  request: Request,
  noun: string,
  render: (client: AppRouterClient) => Promise<{ bytes: Uint8Array; fileName: string }>,
): Promise<Response> {
  const context = createRequestContext(new Headers(request.headers));

  const client: AppRouterClient = createRouterClient(appRouter, { context: () => context });

  try {
    const { bytes, fileName } = await render(client);

    const headers = new Headers({
      "Cache-Control": "private, no-store",
      "Content-Disposition": contentDisposition("inline", fileName, "document.pdf"),
      "Content-Type": "application/pdf",
    });

    for (const cookie of (await context).setCookies) headers.append("set-cookie", cookie);

    return new Response(new Uint8Array(bytes).buffer, { headers });
  } catch (error) {
    // A 4xx message is written for the user; a 5xx one names internal state.
    if (error instanceof ORPCError && error.status < 500) {
      return new Response(error.message, { status: error.status });
    }

    console.error(error);

    return new Response(`Could not render the ${noun}`, { status: 500 });
  }
}
