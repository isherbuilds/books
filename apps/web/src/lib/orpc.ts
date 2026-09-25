import { env } from "@accly/env/web";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { BatchLinkPlugin } from "@orpc/client/plugins";
import { createRouterClient, type RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { createRequestContext, type ORPCContext } from "@accly/api/lib/context";
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

        const context = createRequestContext(new Headers(request.headers));
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
          // A batch response cannot carry a File, so the XLSX exports travel alone.
          exclude: ({ path }) => path[0] === "export",
        }),
      ],
    });

    return createORPCClient(link);
  });

const client = getORPCClient();

export const orpc = createTanstackQueryUtils(client);
