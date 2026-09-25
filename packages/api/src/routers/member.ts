import { auth, invitationUrl } from "@accly/auth";
import { ORG_ROLES, authorize } from "@accly/auth/access";
import { db } from "@accly/db";
import { invitation, member, organization, user } from "@accly/db/schema/auth";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, gt, ilike, or } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { isFounder } from "../lib/founder";
import { capMasterList, MASTER_LIST_LIMIT } from "../lib/master-list";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { likePattern, pageLimit, searchQuery } from "../lib/schemas";
import { orgSettings, pageOf } from "../lib/settlements";

const roleInput = z.enum(ORG_ROLES);

// A member id from another tenant must not reach Better Auth's own endpoints.
async function assertMemberIdInScope(memberId: string, orgId: string): Promise<void> {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, orgId)))
    .limit(1);

  if (!row) {
    throw new ORPCError("NOT_FOUND", { message: "Member not found" });
  }
}

// Writes delegate to Better Auth as the caller so its invariants hold, always with
// an explicit `organizationId` — never the session's active org.
export const memberRouter = {
  me: orgProcedure({ member: ["read"] }, orgInput).handler(async ({ context }) => {
    const { orgId, roles, userId } = context.scope;
    const sessionUser = context.session!.user;

    const [organizations, settings] = await Promise.all([
      // Predicate on `userId` by design: this lists which orgs the user belongs to, never
      // data inside one.
      db
        .select({
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
        })
        .from(member)
        .innerJoin(organization, eq(organization.id, member.organizationId))
        .where(eq(member.userId, userId))
        .orderBy(asc(organization.name), asc(organization.id)),
      orgSettings(orgId),
    ]);

    return {
      roles,
      user: { name: sessionUser.name, email: sessionUser.email },
      // Only the flag reaches the client, never FOUNDING_EMAIL.
      founder: isFounder(sessionUser.email),
      organizations,
      timeZone: settings.timeZone,
      // Every org page needs the financial year: the period presets are built from it.
      financialYearStart: settings.financialYearStart,
    };
  }),

  list: orgProcedure(
    { member: ["read"] },
    orgInput.extend({
      q: searchQuery,
      cursor: z.uuid().optional(),
      limit: pageLimit,
    }),
  ).handler(async ({ context, input }) => {
    const { orgId, roles } = context.scope;
    const search = input.q ? likePattern(input.q) : undefined;
    // An invitation id creates the invited account, so only members who
    // could have issued it get the rows and their links.
    const canInvite = authorize(roles, { invitation: ["create"] });

    const [members, invited] = await Promise.all([
      db
        .select({
          id: member.id,
          userId: member.userId,
          role: member.role,
          name: user.name,
          email: user.email,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(
          and(
            eq(member.organizationId, orgId),
            // Ids are UUIDv7, so id order is join order and a keyset cursor.
            input.cursor ? gt(member.id, input.cursor) : undefined,
            search ? or(ilike(user.name, search), ilike(user.email, search)) : undefined,
          ),
        )
        .orderBy(asc(member.id))
        .limit(input.limit + 1),
      // Pending invitations expire within days, so the first page carries them all.
      canInvite && !input.cursor
        ? db
            .select({
              id: invitation.id,
              email: invitation.email,
              role: invitation.role,
              expiresAt: invitation.expiresAt,
            })
            .from(invitation)
            .where(
              and(
                eq(invitation.organizationId, orgId),
                eq(invitation.status, "pending"),
                gt(invitation.expiresAt, new Date()),
                search ? ilike(invitation.email, search) : undefined,
              ),
            )
            .orderBy(asc(invitation.expiresAt), asc(invitation.id))
            .limit(MASTER_LIST_LIMIT + 1)
            .then(capMasterList)
        : [],
    ]);

    const page = pageOf(members, input.limit);

    return {
      members: page.rows,
      hasMore: page.hasMore,
      invitations: invited.map((row) => ({ ...row, url: invitationUrl(row.id) })),
    };
  }),

  // The complete roster for a Link Field: complete or refused, never a page (client-patterns.md).
  options: orgProcedure({ member: ["read"] }, orgInput).handler(async ({ context }) => {
    const rows = await db
      .select({ userId: member.userId, name: user.name, email: user.email })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(eq(member.organizationId, context.scope.orgId))
      .orderBy(asc(user.name), asc(member.userId))
      .limit(MASTER_LIST_LIMIT + 1);

    return capMasterList(rows);
  }),

  invite: orgProcedure(
    { invitation: ["create"] },
    orgInput.extend({ email: z.email(), role: roleInput }),
  ).handler(async ({ context, input }) => {
    const created = await auth.api.createInvitation({
      body: {
        email: input.email,
        role: input.role,
        organizationId: context.scope.orgId,
      },
      headers: context.headers,
    });

    audit({
      action: "member.invite",
      actorId: context.scope.userId,
      orgId: context.scope.orgId,
      target: `email:${input.email}`,
      meta: { role: input.role },
    });

    // The link is the recipient's proof of eligibility until email delivery exists.
    return {
      id: created.id,
      email: created.email,
      url: invitationUrl(created.id),
    };
  }),

  revokeInvitation: orgProcedure(
    { invitation: ["cancel"] },
    orgInput.extend({ invitationId: z.string().min(1) }),
  ).handler(async ({ context, input }) => {
    // Scoped read first: a foreign invitation id must not reach Better Auth's cancel path.
    const [row] = await db
      .select({ email: invitation.email })
      .from(invitation)
      .where(
        and(
          eq(invitation.id, input.invitationId),
          eq(invitation.organizationId, context.scope.orgId),
        ),
      )
      .limit(1);

    if (!row) {
      throw new ORPCError("NOT_FOUND", { message: "Invitation not found" });
    }

    await auth.api.cancelInvitation({
      body: { invitationId: input.invitationId },
      headers: context.headers,
    });

    audit({
      action: "member.invite.revoke",
      actorId: context.scope.userId,
      orgId: context.scope.orgId,
      target: `email:${row.email}`,
    });
  }),

  updateRole: orgProcedure(
    { member: ["update"] },
    orgInput.extend({ memberId: z.string().min(1), role: roleInput }),
  ).handler(async ({ context, input }) => {
    await assertMemberIdInScope(input.memberId, context.scope.orgId);

    await auth.api.updateMemberRole({
      body: {
        memberId: input.memberId,
        role: input.role,
        organizationId: context.scope.orgId,
      },
      headers: context.headers,
    });

    audit({
      action: "member.role.update",
      actorId: context.scope.userId,
      orgId: context.scope.orgId,
      target: `member:${input.memberId}`,
      meta: { role: input.role },
    });
  }),

  remove: orgProcedure(
    { member: ["delete"] },
    orgInput.extend({ memberId: z.string().min(1) }),
  ).handler(async ({ context, input }) => {
    await assertMemberIdInScope(input.memberId, context.scope.orgId);

    await auth.api.removeMember({
      body: {
        memberIdOrEmail: input.memberId,
        organizationId: context.scope.orgId,
      },
      headers: context.headers,
    });

    audit({
      action: "member.remove",
      actorId: context.scope.userId,
      orgId: context.scope.orgId,
      target: `member:${input.memberId}`,
    });
  }),
};
