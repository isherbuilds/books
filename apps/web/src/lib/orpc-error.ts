import { notFound } from "@tanstack/react-router";
import type { FieldPath, FieldValues, UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

/**
 * Walks an error and its `cause` chain. Transport wraps server errors, so the
 * code, data code and reason a handler threw are never on the outermost error.
 * The `seen` set stops a self-referential cause from looping forever.
 */
function* causes(error: unknown) {
  const seen = new Set<unknown>();
  let current = error;

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    yield current;
    current = "cause" in current ? current.cause : undefined;
  }
}

export function hasErrorCode(error: unknown, code: string): boolean {
  for (const link of causes(error)) {
    if ("code" in link && link.code === code) return true;
  }

  return false;
}

/** The first reason supplied by the server; callers match only reasons they handle. */
export function errorReason(error: unknown): string | undefined {
  for (const link of causes(error)) {
    if (!("data" in link)) continue;

    const data = link.data;

    if (data && typeof data === "object" && "reason" in data && typeof data.reason === "string") {
      return data.reason;
    }
  }

  return undefined;
}

function status(error: unknown): number | undefined {
  for (const link of causes(error)) {
    if ("status" in link && typeof link.status === "number") return link.status;
  }

  return undefined;
}

/**
 * The server answered and wrote nothing. A 5xx or a dropped connection (fetch rejects
 * with a TypeError) may still have committed the write.
 */
export function isRefusal(error: unknown): boolean {
  const code = status(error);

  return code !== undefined && code < 500;
}

/**
 * The server's wording when it sent one, the caller's fallback otherwise.
 *
 * Every API throw now carries a message, so the fallback is not dead copy: it is
 * what staff read when the server 5xxes, because an invariant report is written for
 * the logs and must never reach a screen. Name the action where you can — "Could not
 * record the payment" beats the generic default at the moment it actually shows.
 */
export function errorMessage(error: unknown, fallback = "Something went wrong"): string {
  // fetch rejects a dropped connection with a TypeError ("Failed to fetch", "Load
  // failed"): a browser sentence, not one an operator can act on.
  if (error instanceof TypeError || (status(error) ?? 0) >= 500) return fallback;

  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Puts a refused submit on the field its server `reason` names, in the server's
 * words, and toasts every other refusal. `fields` maps a reason to its field.
 */
export function applyOrpcFieldError<TFieldValues extends FieldValues, TContext, TTransformedValues>(
  form: UseFormReturn<TFieldValues, TContext, TTransformedValues>,
  error: unknown,
  fields: Partial<Record<string, FieldPath<TFieldValues>>>,
  fallback: string,
): void {
  const reason = errorReason(error);
  // `hasOwn`: a reason must never resolve through the prototype ("constructor").
  const field = reason !== undefined && Object.hasOwn(fields, reason) ? fields[reason] : undefined;

  if (field) {
    form.setError(field, { message: errorMessage(error, fallback) }, { shouldFocus: true });

    return;
  }

  toast.error(errorMessage(error, fallback));
}

const GENERIC_ROUTE_ERROR = "An unexpected error interrupted the request.";

// The SSR client calls procedures in-process, so a driver error is not normalized
// by the HTTP transport. Production HTML must not echo that message.
export function routeErrorMessage(error: unknown, exposeInternal: boolean): string {
  return exposeInternal ? errorMessage(error, GENERIC_ROUTE_ERROR) : GENERIC_ROUTE_ERROR;
}

export async function loadRouteQuery<T>(query: Promise<T>): Promise<T> {
  try {
    return await query;
  } catch (error) {
    if (hasErrorCode(error, "NOT_FOUND")) throw notFound();
    throw error;
  }
}
