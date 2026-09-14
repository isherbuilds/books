import { ORPCError } from "@orpc/server";

/**
 * Why a CONFLICT happened when a client can take a specific recovery path.
 * Every other CONFLICT is a plain `ORPCError("CONFLICT")`: the client refetches
 * and shows the server message.
 */
export type ConflictReason =
  | "DUPLICATE"
  | "STALE_RECORD"
  | "PARTY_NAME_COLLISION"
  | "PARTY_GSTIN_TAKEN";

/** A clash the operator can act on. Expected, so the server does not log it. */
export function conflict(reason: ConflictReason, message: string) {
  return new ORPCError("CONFLICT", { message, data: { reason } });
}

export function badRequest(reason: string, message: string) {
  return new ORPCError("BAD_REQUEST", { message, data: { reason } });
}

/**
 * A state the surrounding transaction should have made impossible — a locked row
 * that vanished, an UPDATE that matched fewer rows than it just selected.
 *
 * This must stay 5xx. `logORPCError` in apps/server drops everything under 500, so
 * dressing a bug as a CONFLICT hides it from the logs and shows staff "Conflict".
 * The message reaches the log, never the browser: the client shows a generic line
 * for any 5xx.
 */
export function impossible(what: string) {
  return new ORPCError("INTERNAL_SERVER_ERROR", { message: `Invariant violated: ${what}` });
}
