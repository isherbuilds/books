import { createRequestContext } from "@accly/api/lib/context";
import { appRouter, type AppRouterClient } from "@accly/api/routers/index";
import { createRouterClient, ORPCError } from "@orpc/server";
import { expect } from "bun:test";

import type { TestUser } from "./auth";

// One context per call, like one HTTP request per call. Use for anything that
// must be re-proven per request, such as revocation.
export function clientFor(identity: TestUser): AppRouterClient {
  const headers = new Headers({ cookie: identity.cookie });

  return createRouterClient(appRouter, {
    context: () => createRequestContext(headers),
  });
}

// One context for every call, like a server-rendered page fanning out. The
// permission check still runs per call.
export function requestScopedClientFor(identity: TestUser): AppRouterClient {
  const headers = new Headers({ cookie: identity.cookie });
  const context = createRequestContext(headers);

  return createRouterClient(appRouter, { context: () => context });
}

async function rejection(promise: Promise<unknown>, what: string): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof Error)) throw new Error(`expected ${what} to reject with an Error`);

    return error;
  }

  throw new Error(`expected ${what} to reject`);
}

export async function expectORPCCode(
  promise: Promise<unknown>,
  code: string,
  label = "the call",
): Promise<ORPCError<string, unknown>> {
  const error = await rejection(promise, `${label} with ${code}`);

  if (!(error instanceof ORPCError)) throw new Error(`expected ${label} to reject with ORPCError`);

  expect(error.code, `${label} should be ${code}`).toBe(code);

  return error;
}

export async function expectReason(promise: Promise<unknown>, reason: string): Promise<void> {
  const error = await expectORPCCode(promise, "BAD_REQUEST");
  expect(error.data).toMatchObject({ reason });
}

export async function expectAuthStatus(
  promise: Promise<unknown>,
  status: string,
  bodyCode?: string,
): Promise<void> {
  const error = await rejection(promise, `the Better Auth call with ${status}`);
  expect(error).toHaveProperty("status", status);

  if (bodyCode !== undefined) {
    expect(error).toHaveProperty("body.code", bodyCode);
  }
}

export async function eventually<T>(
  probe: () => Promise<T | undefined>,
  timeoutMs = 1_000,
): Promise<T> {
  const deadline = performance.now() + timeoutMs;

  while (performance.now() < deadline) {
    const result = await probe();

    if (result !== undefined) {
      return result;
    }

    await Bun.sleep(Math.min(20, Math.max(0, deadline - performance.now())));
  }

  throw new Error(`condition not reached within ${timeoutMs}ms`);
}
