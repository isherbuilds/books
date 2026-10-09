import { authorize, parseRoles, type AppPermission, type RoleKey } from "@accly/auth/access";
import { ORGANIZATION_SLUG_MAX_LENGTH } from "@accly/auth/organization-slug";
import { db } from "@accly/db";
import { member, organization } from "@accly/db/schema/auth";
import { ORPCError, os, type InferSchemaOutput } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { audit } from "@accly/db/audit";
import type { OrgMembership, ORPCContext } from "../context";

export type Scope = {
  userId: string;
  orgId: string;
  roles: RoleKey[];
};

// Not exported: every procedure goes through an explicit authentication boundary.
const base = os.$context<ORPCContext>();

export const sessionProcedure = base.use(async ({ context, next }) => {
  if (!context.session) {
    throw new ORPCError("UNAUTHORIZED", { message: "Sign in to continue." });
  }

  return next({ context: { session: context.session } });
});

// The unverified claim, named by the page URL. Safe to key authorization on only
// because slug changes are rejected after creation. Handlers scope on
// `context.scope.orgId` — never on this. Capped because it reaches SQL and the
// denial log before membership is known.
export const orgInput = z.object({ orgSlug: z.string().min(1).max(ORGANIZATION_SLUG_MAX_LENGTH) });

// The promise is memoized before it settles, so calls fanning out from one page
// render share a single in-flight join. A `null` result is memoized too.
async function resolveMembership(
  context: ORPCContext,
  userId: string,
  orgSlug: string,
): Promise<OrgMembership | null> {
  const memoized = context.memberships.get(orgSlug);

  if (memoized) {
    return memoized;
  }

  // One statement for slug and membership: "no such org" and "not a member" must
  // stay indistinguishable to the caller. `parseRoles` throws on an unknown role.
  const pending = db
    .select({ role: member.role, orgId: organization.id })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(and(eq(organization.slug, orgSlug), eq(member.userId, userId)))
    .limit(1)
    .then(([row]) => (row ? { orgId: row.orgId, roles: parseRoles(row.role) } : null));

  context.memberships.set(orgSlug, pending);

  return pending;
}

// One wording for "no such org" and "you are not a member". Telling them apart would
// leak the existence that answering FORBIDDEN instead of NOT_FOUND exists to hide.
const NO_ORG_ACCESS = "You do not have access to this organization.";

async function authorizeOrg(
  context: ORPCContext,
  orgSlug: string,
  permission: AppPermission,
): Promise<Scope> {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED", { message: "Sign in to continue." });
  }

  const userId = context.session.user.id;
  const membership = await resolveMembership(context, userId, orgSlug);

  if (!membership) {
    // Never written to the tenant audit trail: an outsider must not inject rows, or
    // leak their user id, into an org they don't belong to (tenancy.test.ts).
    console.warn(
      JSON.stringify({ event: "rbac.membership.denied", actorId: userId, claimedSlug: orgSlug }),
    );
    throw new ORPCError("FORBIDDEN", { message: NO_ORG_ACCESS });
  }

  const scope = { userId, ...membership };
  requirePermission(scope, permission);

  return scope;
}

/**
 * The guard's permission check. Outside the guard it serves only a grant that stored
 * data decides — an allocation that names a Journal — since the input cannot show it.
 * A denial is audited like the guard's own.
 */
export function requirePermission(scope: Scope, permission: AppPermission): void {
  if (authorize(scope.roles, permission)) return;

  audit({
    action: "rbac.permission",
    denied: true,
    actorId: scope.userId,
    orgId: scope.orgId,
    meta: { roles: scope.roles, permission },
  });
  throw new ORPCError("FORBIDDEN", { message: "You do not have permission to do that." });
}

/**
 * `permission` is the grant the whole call needs. A function derives it from the parsed
 * input when part of the input needs more (a counter sale's Receipt, a refund's credits),
 * so every denial is decided and audited here, before the handler runs.
 */
export const orgProcedure = <TSchema extends z.ZodType<{ orgSlug: string }, unknown>>(
  permission: AppPermission | ((input: InferSchemaOutput<TSchema>) => AppPermission),
  input: TSchema,
) =>
  base.input(input).use(async ({ context, next }, parsed: InferSchemaOutput<TSchema>) => {
    const scope = await authorizeOrg(
      context,
      parsed.orgSlug,
      typeof permission === "function" ? permission(parsed) : permission,
    );

    return next({ context: { scope } });
  });
