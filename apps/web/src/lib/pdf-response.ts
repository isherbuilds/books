import { createRequestContext } from "@accly/api/lib/context";
import type { AppRouterClient } from "@accly/api/routers/index";
import { appRouter } from "@accly/api/routers/index";
import { contentDisposition } from "@accly/storage/content-disposition";
import { ORPCError, createRouterClient } from "@orpc/server";

const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

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
    // The PDF opens in a new tab, so an error needs a readable page, not raw text.
    const clientError = error instanceof ORPCError && error.status < 500;

    if (!clientError) console.error(error);

    const message = clientError ? error.message : `Could not render the ${noun}`;

    const safeMessage = message.replace(
      /[&<>"']/g,
      (character) => HTML_ENTITIES[character] ?? character,
    );

    return new Response(
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PDF unavailable</title><main style="font:16px system-ui,sans-serif;max-width:40rem;margin:10vh auto;padding:1rem"><h1>PDF unavailable</h1><p>${safeMessage}</p></main></html>`,
      {
        status: clientError ? error.status : 500,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "private, no-store",
        },
      },
    );
  }
}
