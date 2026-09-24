import { beforeAll, expect, spyOn, test } from "bun:test";

import { auth, invitationUrl } from "@accly/auth";
import { createUserWithPassword } from "@accly/auth/manual-user";
import { db } from "@accly/db";
import { invitation, member, user } from "@accly/db/schema/auth";
import { file } from "@accly/db/schema/file";
import { env } from "@accly/env/server";
import { and, eq } from "drizzle-orm";

import { app } from "../../apps/server/src/index";
import {
  createAccountingOrganization,
  createOrganization,
  createTestUser,
  joinOrganization,
} from "../support/auth";
import { expectAuthStatus, expectORPCCode } from "../support/client";
import { resetTestDatabase } from "../support/database";

beforeAll(async () => {
  await resetTestDatabase();
});

test("public email sign-up is refused without an invitation", async () => {
  await expectAuthStatus(
    auth.api.signUpEmail({
      body: {
        email: `signup-${Bun.randomUUIDv7()}@example.com`,
        name: "Sign-up probe",
        password: "integration-test-password",
      },
    }),
    "FORBIDDEN",
    "INVITATION_REQUIRED",
  );

  const [probe] = await db.select({ id: user.id }).from(user).limit(1);
  expect(probe?.id).toBeUndefined();
});

test("organization invitations enter through the join route", () => {
  expect(new URL(invitationUrl("invite-id")).pathname).toBe("/join");
  expect(new URL(invitationUrl("invite-id")).searchParams.get("invitation")).toBe("invite-id");
});

test("an operator-created account can sign in and is email-verified for account linking", async () => {
  const email = `operator-${Bun.randomUUIDv7()}@example.com`;

  const { id } = await createUserWithPassword({
    email,
    name: "Operator user",
    password: "integration-test-password",
  });

  const [created] = await db
    .select({ emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.id, id));

  expect(created?.emailVerified).toBe(true);

  const { headers } = await auth.api.signInEmail({
    body: { email, password: "integration-test-password" },
    returnHeaders: true,
  });

  expect(headers.get("set-cookie")).toContain("session");
});

test("only the founding email can create an organization", async () => {
  await createUserWithPassword({
    email: env.FOUNDING_EMAIL,
    name: "Founding operator",
    password: "integration-test-password",
  });

  const signIn = await auth.api.signInEmail({
    body: { email: env.FOUNDING_EMAIL, password: "integration-test-password" },
    returnHeaders: true,
  });

  const cookie = signIn.headers.get("set-cookie")?.split(";")[0];
  expect(cookie).toBeDefined();
  const founder = new Headers({ cookie: cookie! });

  const stranger = await createTestUser("bootstrap-stranger");
  await expectORPCCode(
    createAccountingOrganization(stranger.headers, { name: "Too early", slug: "too-early" }),
    "FORBIDDEN",
  );

  const first = await createAccountingOrganization(founder, {
    name: "First Org",
    slug: "first-org",
  });

  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(eq(member.organizationId, first.id));

  expect(membership?.role).toBe("owner");

  const second = await createAccountingOrganization(founder, {
    name: "Second Org",
    slug: "second-org",
  });

  expect(second.id).not.toBe(first.id);

  const owner = await createTestUser("gate-owner");
  await createOrganization(owner, "gate");
  await expectORPCCode(
    createAccountingOrganization(owner.headers, {
      name: "Not Even For Owners",
      slug: "not-even-owners",
    }),
    "FORBIDDEN",
  );
});

test("short and reserved root slugs cannot create organizations", async () => {
  const { headers } = await auth.api.signInEmail({
    body: { email: env.FOUNDING_EMAIL, password: "integration-test-password" },
    returnHeaders: true,
  });

  const cookie = headers.get("set-cookie")?.split(";")[0];
  expect(cookie).toBeDefined();

  for (const slug of ["abc", "CREATE", "docs", "blog"]) {
    await expectORPCCode(
      createAccountingOrganization(new Headers({ cookie: cookie! }), { slug }),
      "BAD_REQUEST",
    );
  }
});

test("organization deletion stays disabled until external objects can be cleaned up", async () => {
  const owner = await createTestUser("delete-org-owner");
  const organization = await createOrganization(owner, "delete-org");

  // Pins Better Auth's machine-readable code, not the sentence it renders as.
  await expectAuthStatus(
    auth.api.deleteOrganization({
      body: { organizationId: organization.id },
      headers: owner.headers,
    }),
    "NOT_FOUND",
    "ORGANIZATION_DELETION_DISABLED",
  );
});

test("a user can have only one membership row per organization", async () => {
  const owner = await createTestUser("unique-member-owner");
  const organization = await createOrganization(owner, "unique-member");

  await expect(
    db
      .insert(member)
      .values({
        id: Bun.randomUUIDv7(),
        organizationId: organization.id,
        userId: owner.user.id,
        role: "operator",
        createdAt: new Date(),
      })
      .execute(),
  ).rejects.toThrow();
});

test("deleting an attributed user preserves organization content", async () => {
  const owner = await createTestUser("attribution-owner");
  const organization = await createOrganization(owner, "attribution");
  const fileId = `${organization.id}/${Bun.randomUUIDv7()}/keep.txt`;
  await db.insert(file).values({
    id: fileId,
    orgId: organization.id,
    userId: owner.user.id,
    name: "keep.txt",
    size: 1,
    status: "ready",
  });

  await db.delete(user).where(eq(user.id, owner.user.id));

  const [preservedFile] = await db.select().from(file).where(eq(file.id, fileId));
  expect(preservedFile?.userId).toBeNull();
});

// A pending invitation id plus its email is the sign-up proof, so no Better Auth
// endpoint may hand one to a member without the invite grant.
test("only the browser's organization endpoints are served over HTTP", async () => {
  const owner = await createTestUser("direct-surface-owner");
  const organization = await createOrganization(owner, "direct-surface");
  const operator = await createTestUser("direct-surface-operator");
  await joinOrganization(operator, organization.id);
  await auth.api.createInvitation({
    body: {
      email: `direct-surface-${Bun.randomUUIDv7()}@example.com`,
      role: "owner",
      organizationId: organization.id,
    },
    headers: owner.headers,
  });

  const call = (method: "GET" | "POST", path: string, body?: Record<string, string>) =>
    app.request(`http://localhost/api/auth/organization/${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: operator.cookie },
      body: body && JSON.stringify(body),
    });

  for (const response of await Promise.all([
    call("GET", `list-invitations?organizationId=${organization.id}`),
    call("GET", `get-full-organization?organizationId=${organization.id}`),
    call("GET", `list-members?organizationId=${organization.id}`),
    call("POST", "check-slug", { slug: "unclaimed-workspace" }),
    call("POST", "invite-member", {
      email: "x@example.com",
      role: "owner",
      organizationId: organization.id,
    }),
    call("POST", "remove-member", {
      organizationId: organization.id,
      memberIdOrEmail: owner.user.email,
    }),
  ])) {
    expect(response.status).toBe(404);
  }

  // Control: the allowlist still serves the browser.
  const listed = await call("GET", "list");
  expect(listed.status).toBe(200);
  expect(await listed.json()).toEqual([expect.objectContaining({ id: organization.id })]);
});

test("an invitee creates an account from the invitation id, joins, and signs in with the password", async () => {
  const email = `onboarding-${Bun.randomUUIDv7()}@example.com`;
  const owner = await createTestUser("onboarding-owner");
  const organizationName = "onboarding-organization";
  const organization = await createOrganization(owner, organizationName);

  const invited = await auth.api.createInvitation({
    body: { email, role: "operator", organizationId: organization.id },
    headers: owner.headers,
  });

  const queries = spyOn(db.$client, "query");

  try {
    const status = await app.request(
      `/api/auth/invitation/claim-status?invitationId=${invited.id}`,
    );

    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({
      accountExists: false,
      email,
      organizationName,
      organizationSlug: organization.slug,
    });
    expect(queries).toHaveBeenCalledTimes(1);
  } finally {
    queries.mockRestore();
  }

  const password = "integration-test-password";

  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: env.CORS_ORIGIN },
    body: JSON.stringify({ email, name: "Invited User", password, invitationId: invited.id }),
  });

  expect(response.status).toBe(200);

  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");

  expect(cookie).toContain("session");
  // SAFETY: This successful native sign-up response has the Better Auth user contract; assertions below verify its fields.
  const created = (await response.json()) as { user: { id: string; emailVerified: boolean } };
  expect(created.user.emailVerified).toBe(false);
  expect(await auth.api.invitationClaimStatus({ query: { invitationId: invited.id } })).toEqual({
    accountExists: true,
    email,
    organizationName,
    organizationSlug: organization.slug,
  });

  const headers = new Headers({ cookie, origin: env.CORS_ORIGIN });
  await auth.api.acceptInvitation({ body: { invitationId: invited.id }, headers });

  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organization.id), eq(member.userId, created.user.id)));

  expect(membership?.role).toBe("operator");
  expect((await auth.api.signInEmail({ body: { email, password } })).user.id).toBe(created.user.id);
});

test("an invitation id creates only its own invited email while it is live", async () => {
  const email = `revoked-onboarding-${Bun.randomUUIDv7()}@example.com`;
  const owner = await createTestUser("revoked-onboarding-owner");
  const organization = await createOrganization(owner, "revoked-onboarding");

  const invited = await auth.api.createInvitation({
    body: { email, role: "operator", organizationId: organization.id },
    headers: owner.headers,
  });

  const signUp = (body: { email: string; invitationId: string }) =>
    auth.api.signUpEmail({
      body: { name: "Impersonator", password: "integration-test-password", ...body },
    });

  await expectAuthStatus(
    signUp({ email: `other-${Bun.randomUUIDv7()}@example.com`, invitationId: invited.id }),
    "FORBIDDEN",
    "INVITATION_REQUIRED",
  );
  await auth.api.cancelInvitation({ body: { invitationId: invited.id }, headers: owner.headers });
  await expectAuthStatus(
    signUp({ email, invitationId: invited.id }),
    "FORBIDDEN",
    "INVITATION_REQUIRED",
  );
  expect(await db.select({ id: user.id }).from(user).where(eq(user.email, email))).toHaveLength(0);

  const expired = await auth.api.createInvitation({
    body: { email, role: "operator", organizationId: organization.id },
    headers: owner.headers,
  });

  await db
    .update(invitation)
    .set({ expiresAt: new Date(Date.now() - 60_000) })
    .where(eq(invitation.id, expired.id));

  const expiredStatus = await app.request(
    `/api/auth/invitation/claim-status?invitationId=${expired.id}`,
  );

  expect(expiredStatus.status).toBe(404);
  await expectAuthStatus(
    signUp({ email, invitationId: expired.id }),
    "FORBIDDEN",
    "INVITATION_REQUIRED",
  );
});
