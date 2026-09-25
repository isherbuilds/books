// Zod's JIT validator, on for every schema in this process. It walks each schema once
// and emits flat, loop-free JavaScript, which parses objects, arrays and unions ~3-9x
// faster; invalid input falls back to the standard parser, so errors are unchanged.
// Must precede the routers, whose schemas are built at module evaluation.
import "zod/compile";

import { drainAuditWrites } from "@accly/api/audit";
import { createRequestContext, type ORPCContext } from "@accly/api/lib/context";
import { appRouter } from "@accly/api/routers/index";
import { auth } from "@accly/auth";
import { db } from "@accly/db";
import { env } from "@accly/env/server";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { ORPCError, onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { BatchHandlerPlugin } from "@orpc/server/plugins";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { sql } from "drizzle-orm";
import { initLogger } from "evlog";
import { identifyUser } from "evlog/better-auth";
import { createFsDrain } from "evlog/fs";
import { evlog, type EvlogVariables } from "evlog/hono";
import { compress } from "hono/compress";
import { Hono, type Context as HonoContext } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";

initLogger({
  env: { service: "accly-server" },
});

const isProduction = env.NODE_ENV === "production";

export const app = new Hono<EvlogVariables>();

app.use(
  "/*",
  secureHeaders({
    crossOriginResourcePolicy: false,
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
    referrerPolicy: "no-referrer",
    strictTransportSecurity: isProduction ? "max-age=31536000; includeSubDomains" : false,
    xContentTypeOptions: "nosniff",
    xDnsPrefetchControl: false,
    xDownloadOptions: false,
    xFrameOptions: false,
    xPermittedCrossDomainPolicies: false,
    xXssProtection: false,
    permissionsPolicy: {
      camera: false,
      microphone: false,
      geolocation: false,
      payment: false,
    },
    // Production-only so the development API reference can load its scripts and styles.
    contentSecurityPolicy: isProduction
      ? {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        }
      : undefined,
  }),
);

app.use(
  evlog({
    drain: isProduction ? undefined : createFsDrain(),
  }),
);

app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    // oRPC's BatchLinkPlugin marks batched requests with x-orpc-batch.
    allowHeaders: ["Content-Type", "Authorization", "x-orpc-batch"],
    credentials: true,
    // Cache preflight responses so cross-origin RPCs don't pay an OPTIONS round trip.
    maxAge: 86400,
  }),
);

app.use("/*", compress());

// Rejects oversized requests before any session or body parsing.
function limitBody(maxSize: number) {
  return bodyLimit({ maxSize, onError: (c) => c.json({ error: "Request too large" }, 413) });
}

const procedureBodyLimit = limitBody(1024 * 1024);

// Auth bodies are a few credentials; nothing legitimate comes near this.
app.use("/api/auth/*", limitBody(64 * 1024));

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

async function createLoggedRequestContext(
  context: HonoContext<EvlogVariables>,
): Promise<ORPCContext> {
  const startedAt = Date.now();
  const requestContext = await createRequestContext(context.req.raw.headers);

  const identified = requestContext.session
    ? identifyUser(context.get("log"), requestContext.session, {
        maskEmail: true,
      })
    : false;

  context.get("log").set({
    auth: { resolvedIn: Date.now() - startedAt, identified },
  });

  return requestContext;
}

// Expected outcomes reach here too — a duplicate party is a CONFLICT, not a
// fault. Logging those buries the genuine 500s they outnumber.
function logORPCError(error: unknown): void {
  if (error instanceof ORPCError && error.status < 500) {
    return;
  }

  console.error(error);
}

// oRPC sends an ORPCError's message to the client. A 5xx message names an internal
// state (`impossible()`), so the client gets only the code. Listed before
// `onError(logORPCError)`, which therefore still logs the original.
async function redactServerErrors<T>({ next }: { next: () => Promise<T> }): Promise<T> {
  try {
    return await next();
  } catch (error) {
    if (error instanceof ORPCError && error.status >= 500) {
      throw new ORPCError(error.code, { status: error.status });
    }

    throw error;
  }
}

// The web client batches calls made together into one request, and every call in it
// shares one context, so the session and membership resolve once per batch.
const rpcHandler = new RPCHandler(appRouter, {
  plugins: [new BatchHandlerPlugin()],
  interceptors: [redactServerErrors, onError(logORPCError)],
});

// Both handlers resolve the logged request context and answer under their own prefix.
function mount(
  prefix: "/rpc" | "/api-reference",
  handler: Pick<RPCHandler<ORPCContext>, "handle">,
): void {
  app.use(`${prefix}/*`, procedureBodyLimit);
  app.use(`${prefix}/*`, async (c) => {
    const context = await createLoggedRequestContext(c);
    const result = await handler.handle(c.req.raw, { prefix, context });

    if (!result.matched) {
      return c.notFound();
    }

    return c.newResponse(result.response.body, result.response);
  });
}

mount("/rpc", rpcHandler);

if (!isProduction) {
  mount(
    "/api-reference",
    new OpenAPIHandler(appRouter, {
      plugins: [
        new OpenAPIReferencePlugin({
          schemaConverters: [new ZodToJsonSchemaConverter()],
        }),
      ],
      interceptors: [redactServerErrors, onError(logORPCError)],
    }),
  );
}

// Readiness, not liveness: a process that answers while Postgres is unreachable
// reports healthy through an outage in which every request fails.
app.get("/", async (c) => {
  try {
    await db.execute(sql`select 1`);
  } catch (error) {
    console.error("health check failed", error);

    return c.text("UNAVAILABLE", 503);
  }

  return c.text("OK");
});

// Audit writes are fire-and-forget, so a deploy drops whichever are in flight.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void drainAuditWrites()
      .catch((error: unknown) => console.error("audit drain failed", error))
      .finally(() => process.exit(0));
  });
}

export default { port: env.PORT, fetch: app.fetch };
