import { env } from "@accly/env/web";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { BatchLinkPlugin } from "@orpc/client/plugins";
import { createRouterClient, type RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";

import { createRequestContext, type ORPCContext } from "@accly/api/lib/context";
import type { DocumentCursor } from "@accly/api/lib/schemas";
import { appRouter, type AppRouter } from "@accly/api/routers/index";

// Keyed on the request object, which bounds the cache to exactly one request:
// TanStack Start returns that request's `Request` for its whole lifetime. A WeakMap
// lets it be reclaimed, so no session or membership survives into a later request.
const contextByRequest = new WeakMap<Request, Promise<ORPCContext>>();

const getORPCClient = createIsomorphicFn()
  .server((): RouterClient<AppRouter> =>
    createRouterClient(appRouter, {
      context: () => {
        const request = getRequest();
        const cached = contextByRequest.get(request);

        if (cached) return cached;

        // The page response carries any renewed session cookie to the browser.
        const context = createRequestContext(new Headers(request.headers)).then((created) => {
          if (created.setCookies.length > 0) setResponseHeader("set-cookie", created.setCookies);

          return created;
        });

        contextByRequest.set(request, context);

        return context;
      },
    }),
  )
  .client((): RouterClient<AppRouter> => {
    // Calls made in the same tick, such as a page's queries, travel as one request:
    // one CORS preflight, one session check and one membership lookup.
    const link = new RPCLink({
      url: `${env.VITE_SERVER_URL}/rpc`,
      fetch: (url, options) => fetch(url, { ...options, credentials: "include" }),
      plugins: [
        new BatchLinkPlugin({
          groups: [{ condition: () => true, context: {} }],
          // A batch cannot carry a File either way, so XLSX exports and imports travel alone.
          exclude: ({ path }) => path[0] === "export" || path[0] === "import",
        }),
      ],
    });

    return createORPCClient(link);
  });

const client = getORPCClient();

export const orpc = createTanstackQueryUtils(client);

// Keyset paging for id-ordered lists: the next cursor is the last row's id while the
// server reports more.
export const keysetPaging = {
  initialPageParam: undefined,
  getNextPageParam: (last: { hasMore: boolean; rows: { id: string }[] }) =>
    last.hasMore ? last.rows.at(-1)?.id : undefined,
};

// Keyset paging for document registers and pickers, ordered by (document date, id).
export const datedPaging = {
  initialPageParam: undefined,
  getNextPageParam: (last: {
    hasMore: boolean;
    rows: { id: string; documentDate: string }[];
  }): DocumentCursor | undefined => {
    const row = last.rows.at(-1);

    return last.hasMore && row ? { documentDate: row.documentDate, id: row.id } : undefined;
  },
};
