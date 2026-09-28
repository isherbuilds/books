import { auth } from "@accly/auth";
import type { AuthSession } from "@accly/auth";
import type { RoleKey } from "@accly/auth/access";

// Produced only by the `orgProcedure` guard.
export type OrgMembership = {
  orgId: string;
  roles: RoleKey[];
};

export type ORPCContext = {
  headers: Headers;
  session: AuthSession | null;
  /**
   * `Set-Cookie` values from resolving the session: a renewed cookie cache, or a
   * slid session expiry. Every adapter forwards them, so the next request reads the
   * session from its cookie instead of the database.
   */
  setCookies: string[];
  // One server-rendered page fans out into several calls that all prove the same
  // membership. Created per request and never outliving it, so revocation still
  // takes effect on the next request.
  memberships: Map<string, Promise<OrgMembership | null>>;
};

// Every adapter must go through this: a hand-built literal would opt out of the
// shared session and membership map.
export async function createRequestContext(headers: Headers): Promise<ORPCContext> {
  const { headers: sessionHeaders, response: session } = await auth.api.getSession({
    headers,
    returnHeaders: true,
  });

  return { headers, session, setCookies: sessionHeaders.getSetCookie(), memberships: new Map() };
}
