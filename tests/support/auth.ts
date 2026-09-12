import {
  createOrganization as bootstrapOrganization,
  createOrganizationInput,
} from "@accly/api/core/organizations";
import { createRequestContext } from "@accly/api/lib/context";
import { appRouter, type AppRouterClient } from "@accly/api/routers/index";
import { auth } from "@accly/auth";
import type { RoleKey } from "@accly/auth/access";
import { createUserWithPassword } from "@accly/auth/manual-user";
import { createRouterClient } from "@orpc/server";

import { uniqueSuffix } from "./unique";

export type TestUser = {
  cookie: string;
  headers: Headers;
  user: { id: string; email: string; name: string };
};

const TEST_PASSWORD = "integration-test-password";

export async function createTestUser(prefix: string): Promise<TestUser> {
  const email = `${prefix}-${Bun.randomUUIDv7()}@example.com`;
  const name = `${prefix} test user`;
  const { id } = await createUserWithPassword({ email, name, password: TEST_PASSWORD });

  const { headers: responseHeaders } = await auth.api.signInEmail({
    body: { email, password: TEST_PASSWORD },
    returnHeaders: true,
  });

  const setCookie = responseHeaders.get("set-cookie");
  const cookie = setCookie?.split(";")[0];

  if (!cookie) {
    throw new Error("Better Auth sign-in did not return a session cookie");
  }

  return {
    cookie,
    headers: new Headers({ cookie }),
    user: { id, email, name },
  };
}

export async function createFounderSession(): Promise<TestUser> {
  const email = process.env.FOUNDING_EMAIL;

  if (!email) {
    throw new Error("FOUNDING_EMAIL is required for integration tests");
  }

  const name = "Founding operator";
  const { id } = await createUserWithPassword({ email, name, password: TEST_PASSWORD });

  const { headers: responseHeaders } = await auth.api.signInEmail({
    body: { email, password: TEST_PASSWORD },
    returnHeaders: true,
  });

  const cookie = responseHeaders.get("set-cookie")?.split(";")[0];

  if (!cookie) {
    throw new Error("Better Auth sign-in did not return a founder session cookie");
  }

  return {
    cookie,
    headers: new Headers({ cookie }),
    user: { id, email, name },
  };
}

type AccountingOrganizationInput = Parameters<AppRouterClient["organization"]["create"]>[0];

export async function createAccountingOrganization(
  founderHeaders: Headers,
  overrides: Partial<AccountingOrganizationInput> = {},
): Promise<{ id: string; slug: string }> {
  const suffix = uniqueSuffix();

  const api = createRouterClient(appRouter, {
    context: () => createRequestContext(founderHeaders),
  });

  return api.organization.create({
    name: `Accounting organization ${suffix}`,
    slug: `accounting-${suffix}`,
    legalType: "company",
    legalName: `Accounting Organization ${suffix} Private Limited`,
    pan: "ABCDE1234F",
    stateCode: "27",
    addressLine1: "1 Test Street",
    city: "Pune",
    pinCode: "411001",
    ...overrides,
  });
}

export async function createOrganization(
  owner: TestUser,
  name: string,
): Promise<{ id: string; slug: string }> {
  return bootstrapOrganization(
    owner.user.id,
    createOrganizationInput.parse({
      name,
      slug: `${name}-${uniqueSuffix()}`,
      legalType: "company",
      legalName: name,
      pan: "ABCDE1234F",
      stateCode: "27",
      addressLine1: "1 Test Street",
      city: "Pune",
      pinCode: "411001",
    }),
  );
}

export async function joinOrganization(
  joiner: TestUser,
  organizationId: string,
  role: RoleKey = "reception",
): Promise<void> {
  await auth.api.addMember({
    body: { userId: joiner.user.id, organizationId, role },
  });
}

export async function setMemberRoles(
  owner: TestUser,
  memberId: string,
  roles: RoleKey[],
  organizationId: string,
): Promise<void> {
  await auth.api.updateMemberRole({
    body: { memberId, role: roles, organizationId },
    headers: owner.headers,
  });
}

export async function removeFromOrganization(
  owner: TestUser,
  memberEmail: string,
  organizationId: string,
): Promise<void> {
  await auth.api.removeMember({
    body: { memberIdOrEmail: memberEmail, organizationId },
    headers: owner.headers,
  });
}
