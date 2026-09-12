import { beforeAll, expect, test } from "bun:test";

import { auth } from "@accly/auth";
import { SYSTEM_ACCOUNT_KEYS } from "@accly/api/core/chart-templates";
import type { AppRouterClient } from "@accly/api/routers/index";
import { db } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";

import {
  createAccountingOrganization,
  createFounderSession,
  createTestUser,
  joinOrganization,
  removeFromOrganization,
  type TestUser,
} from "../support/auth";
import { clientFor, expectORPCCode } from "../support/client";
import { resetTestDatabase } from "../support/database";
import { uniqueSuffix } from "../support/unique";

let founder: TestUser;

beforeAll(async () => {
  await resetTestDatabase();
  founder = await createFounderSession();
});

type PartyCreateInput = Parameters<AppRouterClient["party"]["create"]>[0];

async function expectCoreError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof ORPCError)) throw error;
    expect(error.code).toBe(code);

    return error;
  }

  throw new Error("Expected core call to reject");
}

function partyCreateInput(orgSlug: string, name: string): PartyCreateInput {
  return {
    orgSlug,
    name,
    roles: ["customer"],
    stateCode: "27",
  };
}

test("founder organization creation seeds the complete chart and profile", async () => {
  const suffix = uniqueSuffix();

  const organization = await createAccountingOrganization(founder.headers, {
    name: `Seeded company ${suffix}`,
    slug: `seeded-company-${suffix}`,
    legalType: "company",
    legalName: `Seeded Company ${suffix} Private Limited`,
    timeZone: "UTC",
  });

  const api = clientFor(founder);

  const seededAccounts = await db
    .select({ systemKey: accounts.systemKey })
    .from(accounts)
    .where(eq(accounts.orgId, organization.id));

  for (const systemKey of SYSTEM_ACCOUNT_KEYS) {
    expect(seededAccounts.filter((account) => account.systemKey === systemKey)).toHaveLength(1);
  }

  const profile = await api.organization.getProfile({ orgSlug: organization.slug });
  expect(profile.legalType).toBe("company");
  expect(profile.timeZone).toBe("UTC");
  expect((await api.member.me({ orgSlug: organization.slug })).timeZone).toBe("UTC");
  const settings = await api.settings.get({ orgSlug: organization.slug });
  await api.settings.update({ ...settings, orgSlug: organization.slug, timeZone: "Europe/London" });
  expect((await api.organization.getProfile({ orgSlug: organization.slug })).timeZone).toBe(
    "Europe/London",
  );
  expect((await api.member.me({ orgSlug: organization.slug })).timeZone).toBe("Europe/London");

  const native = await auth.handler(
    new Request("http://localhost:55443/api/auth/organization/create", {
      method: "POST",
      headers: { cookie: founder.cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Incomplete", slug: `incomplete-${suffix}` }),
    }),
  );

  expect(native.status).toBe(404);
  await expect(
    auth.api.createOrganization({
      body: { name: "Incomplete", slug: `system-${suffix}`, userId: founder.user.id },
    }),
  ).rejects.toMatchObject({ status: "FORBIDDEN" });

  await expectORPCCode(
    createAccountingOrganization(founder.headers, {
      slug: `invalid-tax-identity-${suffix}`,
      gstin: "29ABCDE1234F1Z5",
      stateCode: "27",
    }),
    "BAD_REQUEST",
  );
  const stranger = await createTestUser(`non-founder-${uniqueSuffix()}`);
  await expectORPCCode(
    createAccountingOrganization(stranger.headers, {
      slug: `forbidden-company-${uniqueSuffix()}`,
    }),
    "FORBIDDEN",
  );
});

test("party namesakes, GSTIN uniqueness, and listing are explicit", async () => {
  const organization = await createAccountingOrganization(founder.headers, {
    slug: `party-core-${uniqueSuffix()}`,
  });

  const api = clientFor(founder);

  const originalInput: PartyCreateInput = {
    ...partyCreateInput(organization.slug, "Acme & Co."),
    roles: ["customer", "vendor"],
    gstin: "27abcde1234f1z5",
  };

  const original = await api.party.create(originalInput);
  expect(original).toMatchObject({
    name: "Acme & Co.",
    roles: ["customer", "vendor"],
    stateCode: "27",
    gstin: "27ABCDE1234F1Z5",
  });

  await expectORPCCode(
    api.party.create({
      ...partyCreateInput(organization.slug, "Repeated role"),
      roles: ["customer", "customer"],
    }),
    "BAD_REQUEST",
  );

  const collisionInput = partyCreateInput(organization.slug, "ACME CO");
  const collision = await expectCoreError(api.party.create(collisionInput), "CONFLICT");
  expect(collision.data).toMatchObject({
    reason: "PARTY_NAME_COLLISION",
    candidateIds: [original.id],
  });

  const namesake = await api.party.create({
    ...partyCreateInput(organization.slug, "ＡＣＭＥ ＣＯ"),
    allowNamesake: true,
  });

  expect(namesake.id).not.toBe(original.id);

  const gstinCollision = await expectCoreError(
    api.party.create({
      ...partyCreateInput(organization.slug, "Different Legal Name"),
      gstin: "27ABCDE1234F1Z5",
    }),
    "CONFLICT",
  );

  expect(gstinCollision.data).toMatchObject({
    reason: "PARTY_GSTIN_TAKEN",
  });

  const [ram, sita] = await Promise.all([
    api.party.create(partyCreateInput(organization.slug, "राम")),
    api.party.create(partyCreateInput(organization.slug, "सीता")),
  ]);

  expect(ram.normalizedName).toBe("राम");
  expect(sita.normalizedName).toBe("सीता");

  const collisions = await Promise.allSettled([
    api.party.create(partyCreateInput(organization.slug, "गीता")),
    api.party.create(partyCreateInput(organization.slug, "गीता")),
  ]);

  expect(collisions.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(collisions.find((result) => result.status === "rejected")).toMatchObject({
    reason: { code: "CONFLICT", data: { reason: "PARTY_NAME_COLLISION" } },
  });

  const listed = await api.party.list({ orgSlug: organization.slug });
  expect(listed).toHaveLength(5);
  expect(listed.map((party) => party.id)).toEqual(
    expect.arrayContaining([original.id, namesake.id, ram.id, sita.id]),
  );
});

test("membership removal is enforced on the next party request", async () => {
  const organization = await createAccountingOrganization(founder.headers, {
    slug: `party-membership-${uniqueSuffix()}`,
  });

  const accountant = await createTestUser(`party-accountant-${uniqueSuffix()}`);
  await joinOrganization(accountant, organization.id, "accountant");
  const accountantApi = clientFor(accountant);

  await accountantApi.party.list({ orgSlug: organization.slug });
  await removeFromOrganization(founder, accountant.user.email, organization.id);
  await expectORPCCode(accountantApi.party.list({ orgSlug: organization.slug }), "FORBIDDEN");
});

test("party ids never cross organization boundaries", async () => {
  const alpha = await createAccountingOrganization(founder.headers, {
    slug: `core-alpha-${uniqueSuffix()}`,
  });

  const beta = await createAccountingOrganization(founder.headers, {
    slug: `core-beta-${uniqueSuffix()}`,
  });

  const api = clientFor(founder);
  const input = partyCreateInput(alpha.slug, `Alpha Party ${uniqueSuffix()}`);
  const alphaParty = await api.party.create(input);

  await expectORPCCode(api.party.get({ orgSlug: beta.slug, partyId: alphaParty.id }), "NOT_FOUND");
});
