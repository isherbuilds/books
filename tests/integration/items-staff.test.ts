import { beforeAll, expect, test } from "bun:test";

import { uniqueViolationConstraint } from "@accly/api/lib/db-errors";

import { createOrganization, createTestUser, joinOrganization } from "../support/auth";
import { clientFor, eventually, expectORPCCode } from "../support/client";
import { resetTestDatabase } from "../support/database";
import { uniqueSuffix } from "../support/unique";
beforeAll(async () => {
  await resetTestDatabase();
});

function itemInput(orgSlug: string, code: string, name = "Consultation") {
  return {
    orgSlug,
    name,
    code,
    category: "consultation" as const,
    unitPrice: "150.00",
    taxRatePercent: "0",
  };
}

test("unique violations remain distinguishable when Postgres omits the constraint name", () => {
  expect(uniqueViolationConstraint({ cause: { code: "23505" } })).toBeNull();
  expect(
    uniqueViolationConstraint({
      cause: { code: "23505", constraint: "items_org_code_idx" },
    }),
  ).toBe("items_org_code_idx");
  expect(uniqueViolationConstraint({ cause: { code: "23503" } })).toBeUndefined();
});

test("item CRUD, filters, deactivation, and code uniqueness are organization-scoped", async () => {
  const owner = await createTestUser("item-crud-owner");
  const one = await createOrganization(owner, "item-crud-one");
  const two = await createOrganization(owner, "item-crud-two");
  const api = clientFor(owner);
  const code = `CONS-${uniqueSuffix()}`;

  const created = await api.item.create(itemInput(one.slug, code));
  expect(created).toMatchObject({
    orgId: one.id,
    name: "Consultation",
    code,
    category: "consultation",
    unitPrice: "150.00",
    active: true,
  });
  expect(typeof created.unitPrice).toBe("string");
  expect(typeof created.taxRatePercent).toBe("string");
  expect((await api.item.list({ orgSlug: one.slug })).items.map((item) => item.id)).toContain(
    created.id,
  );

  const updated = await api.item.update({
    orgSlug: one.slug,
    itemId: created.id,
    name: created.name,
    code: created.code,
    category: created.category,
    unitPrice: "200.00",
    taxRatePercent: created.taxRatePercent,
    taxCode: created.taxCode,
    active: true,
  });
  expect(updated.unitPrice).toBe("200.00");
  expect(typeof updated.unitPrice).toBe("string");
  expect(typeof updated.taxRatePercent).toBe("string");

  await expectORPCCode(api.item.create(itemInput(one.slug, code, "Duplicate")), "CONFLICT");
  const sameCodeElsewhere = await api.item.create(itemInput(two.slug, code));
  expect(sameCodeElsewhere.orgId).toBe(two.id);

  const procedure = await api.item.create({
    ...itemInput(one.slug, `PROC-${uniqueSuffix()}`, "Procedure"),
    category: "procedure",
  });
  await api.item.update({
    orgSlug: one.slug,
    itemId: created.id,
    name: created.name,
    code: created.code,
    category: created.category,
    unitPrice: updated.unitPrice,
    taxRatePercent: updated.taxRatePercent,
    taxCode: updated.taxCode,
    active: false,
  });

  const active = await api.item.list({ orgSlug: one.slug, activeOnly: true });
  expect(active.items.map((item) => item.id)).not.toContain(created.id);
  const all = await api.item.list({ orgSlug: one.slug });
  expect(all.items.map((item) => item.id)).toContain(created.id);
  const procedures = await api.item.list({ orgSlug: one.slug, category: "procedure" });
  expect(procedures.items.map((item) => item.id)).toEqual([procedure.id]);
  expect(procedures.items.every((item) => item.category === "procedure")).toBe(true);
});

test("item list searches and paginates by name and id", async () => {
  const owner = await createTestUser("item-list-owner");
  const organization = await createOrganization(owner, "item-list");
  const api = clientFor(owner);
  const prefix = `Page ${uniqueSuffix()}`;
  const names = [`${prefix} Alpha`, `${prefix} Bravo`, `${prefix} Charlie`];

  await Promise.all(
    names.map((name) =>
      api.item.create(itemInput(organization.slug, `PAGE-${uniqueSuffix()}`, name)),
    ),
  );

  const first = await api.item.list({
    orgSlug: organization.slug,
    query: prefix,
    limit: 2,
  });
  expect(first.items.map((item) => item.name)).toEqual(names.slice(0, 2));
  expect(first.nextCursor).not.toBeNull();
  if (!first.nextCursor) {
    throw new Error("Expected a item cursor");
  }

  const second = await api.item.list({
    orgSlug: organization.slug,
    query: prefix,
    limit: 2,
    cursor: first.nextCursor,
  });
  expect(second.items.map((item) => item.name)).toEqual(names.slice(2));
  expect(second.nextCursor).toBeNull();
});

test("plain members can read item and staff but cannot mutate either domain", async () => {
  const owner = await createTestUser("item-staff-gate-owner");
  const organization = await createOrganization(owner, "item-staff-gate");
  const member = await createTestUser("item-staff-gate-member");
  await joinOrganization(member, organization.id);
  const ownerClient = clientFor(owner);
  const memberClient = clientFor(member);
  const item = await ownerClient.item.create(
    itemInput(organization.slug, `GATE-${uniqueSuffix()}`),
  );

  expect((await memberClient.item.list({ orgSlug: organization.slug })).items).toContainEqual(item);
  expect(await memberClient.staff.listPractitioners({ orgSlug: organization.slug })).toEqual([]);

  await expectORPCCode(
    memberClient.item.create(itemInput(organization.slug, `DENY-${uniqueSuffix()}`)),
    "FORBIDDEN",
  );
  await expectORPCCode(
    memberClient.item.update({
      orgSlug: organization.slug,
      itemId: item.id,
      name: item.name,
      code: item.code,
      category: item.category,
      unitPrice: item.unitPrice,
      taxRatePercent: item.taxRatePercent,
      taxCode: item.taxCode,
      active: item.active,
    }),
    "FORBIDDEN",
  );
  await expectORPCCode(
    memberClient.staff.createDepartment({ orgSlug: organization.slug, name: "Denied" }),
    "FORBIDDEN",
  );
  await expectORPCCode(
    memberClient.staff.createPractitioner({
      orgSlug: organization.slug,
      name: "Denied",
      departmentId: Bun.randomUUIDv7(),
    }),
    "FORBIDDEN",
  );
});

test("service search returns only the first six active matching additional services", async () => {
  const owner = await createTestUser("item-service-search-owner");
  const organization = await createOrganization(owner, "item-service-search");
  const api = clientFor(owner);
  await Promise.all([
    ...Array.from({ length: 7 }, (_, index) =>
      api.item.create({
        ...itemInput(organization.slug, `LAB-${index}-${uniqueSuffix()}`, `Panel ${index}`),
        category: "lab" as const,
      }),
    ),
    api.item.create(itemInput(organization.slug, `CONS-${uniqueSuffix()}`, "Panel consultation")),
    api.item.create({
      ...itemInput(organization.slug, `PROC-${uniqueSuffix()}`, "Panel procedure"),
      category: "procedure" as const,
    }),
  ]);

  const results = await api.item.searchServices({
    orgSlug: organization.slug,
    query: "panel",
    includeConsultation: false,
  });

  expect(results.map((item) => item.name)).toEqual(["Panel procedure"]);
  expect(Object.keys(results[0]!).sort()).toEqual(
    ["category", "code", "id", "name", "taxRatePercent", "unitPrice"].sort(),
  );
});

test("service search includes consultation items only when the caller opts in", async () => {
  const owner = await createTestUser("item-consultation-search-owner");
  const organization = await createOrganization(owner, "item-consultation-search");
  const otherOwner = await createTestUser("item-consultation-search-other-owner");
  const otherOrganization = await createOrganization(otherOwner, "item-consultation-search-other");
  const api = clientFor(owner);
  const query = `Desk consultation ${uniqueSuffix()}`;
  const consultation = await api.item.create(
    itemInput(organization.slug, `CONS-${uniqueSuffix()}`, query),
  );
  await clientFor(otherOwner).item.create(
    itemInput(otherOrganization.slug, `CONS-${uniqueSuffix()}`, query),
  );

  const excluded = await api.item.searchServices({
    orgSlug: organization.slug,
    query,
    includeConsultation: false,
  });
  const unfiltered = await api.item.searchServices({
    orgSlug: organization.slug,
    query,
    includeConsultation: true,
  });
  expect(excluded).toEqual([]);
  expect(unfiltered.map((item) => item.id)).toEqual([consultation.id]);
  expect(unfiltered[0]?.category).toBe("consultation");
});

test("service search excludes consultations before applying the result cap", async () => {
  const owner = await createTestUser("item-service-search-eligibility-owner");
  const organization = await createOrganization(owner, "item-service-search-eligibility");
  const api = clientFor(owner);
  const query = `Later service ${uniqueSuffix()}`;
  const eligible = await api.item.create({
    ...itemInput(organization.slug, `PROC-${uniqueSuffix()}`, `${query} Z eligible`),
    category: "procedure",
  });
  await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      api.item.create(
        itemInput(
          organization.slug,
          `CONS-${index}-${uniqueSuffix()}`,
          `${query} A${index} consultation`,
        ),
      ),
    ),
  );

  const results = await api.item.searchServices({
    orgSlug: organization.slug,
    query,
    includeConsultation: false,
  });

  expect(results.map((item) => item.id)).toEqual([eligible.id]);
});

test("departments and practitioners support linked CRUD within an organization", async () => {
  const owner = await createTestUser("staff-crud-owner");
  const organization = await createOrganization(owner, "staff-crud");
  const member = await createTestUser("staff-crud-member");
  await joinOrganization(member, organization.id);
  const api = clientFor(owner);

  const department = await api.staff.createDepartment({
    orgSlug: organization.slug,
    name: "General Medicine",
  });
  expect(
    (await api.staff.listDepartments({ orgSlug: organization.slug })).map((row) => row.id),
  ).toContain(department.id);
  const renamed = await api.staff.updateDepartment({
    orgSlug: organization.slug,
    departmentId: department.id,
    name: "Internal Medicine",
  });
  expect(renamed.name).toBe("Internal Medicine");
  await expectORPCCode(
    api.staff.createDepartment({ orgSlug: organization.slug, name: "Internal Medicine" }),
    "CONFLICT",
  );

  const fee = await api.item.create(
    itemInput(organization.slug, `FEE-${uniqueSuffix()}`, "Consult Fee"),
  );
  const practitioner = await api.staff.createPractitioner({
    orgSlug: organization.slug,
    name: "Dr. Ada",
    departmentId: department.id,
    registrationNumber: "REG-001",
    memberUserId: member.user.id,
    consultFeeItemId: fee.id,
  });
  expect(practitioner).toMatchObject({
    orgId: organization.id,
    name: "Dr. Ada",
    departmentId: department.id,
    registrationNumber: "REG-001",
    memberUserId: member.user.id,
    consultFeeItemId: fee.id,
  });
  expect(
    (await api.staff.listPractitioners({ orgSlug: organization.slug })).map((row) => row.id),
  ).toContain(practitioner.id);
  expect(
    (
      await api.staff.listPractitioners({
        orgSlug: organization.slug,
        query: "Ada",
      })
    ).map((row) => row.id),
  ).toEqual([practitioner.id]);
  expect(
    await api.staff.listPractitioners({
      orgSlug: organization.slug,
      query: "No Such Practitioner",
    }),
  ).toEqual([]);

  const cleared = await api.staff.updatePractitioner({
    orgSlug: organization.slug,
    practitionerId: practitioner.id,
    name: practitioner.name,
    departmentId: department.id,
    registrationNumber: null,
    memberUserId: null,
    consultFeeItemId: null,
  });
  expect(cleared).toMatchObject({
    registrationNumber: null,
    memberUserId: null,
    consultFeeItemId: null,
  });
});

test("practitioner references cannot cross organization boundaries", async () => {
  const alphaOwner = await createTestUser("staff-reference-alpha");
  const alpha = await createOrganization(alphaOwner, "staff-reference-alpha");
  const betaOwner = await createTestUser("staff-reference-beta");
  const beta = await createOrganization(betaOwner, "staff-reference-beta");
  const alphaClient = clientFor(alphaOwner);
  const betaClient = clientFor(betaOwner);
  const alphaDepartment = await alphaClient.staff.createDepartment({
    orgSlug: alpha.slug,
    name: "Alpha Department",
  });
  const betaDepartment = await betaClient.staff.createDepartment({
    orgSlug: beta.slug,
    name: "Beta Department",
  });
  const betaFee = await betaClient.item.create(itemInput(beta.slug, `BETA-${uniqueSuffix()}`));

  await expectORPCCode(
    alphaClient.staff.createPractitioner({
      orgSlug: alpha.slug,
      name: "Foreign Department",
      departmentId: betaDepartment.id,
    }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    alphaClient.staff.createPractitioner({
      orgSlug: alpha.slug,
      name: "Foreign Fee",
      departmentId: alphaDepartment.id,
      consultFeeItemId: betaFee.id,
    }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    alphaClient.staff.createPractitioner({
      orgSlug: alpha.slug,
      name: "Foreign Member",
      departmentId: alphaDepartment.id,
      memberUserId: betaOwner.user.id,
    }),
    "NOT_FOUND",
  );
});

test("item, department, and practitioner updates hide unknown and foreign ids", async () => {
  const alphaOwner = await createTestUser("staff-update-alpha");
  const alpha = await createOrganization(alphaOwner, "staff-update-alpha");
  const betaOwner = await createTestUser("staff-update-beta");
  const beta = await createOrganization(betaOwner, "staff-update-beta");
  const alphaClient = clientFor(alphaOwner);
  const betaClient = clientFor(betaOwner);
  const alphaDepartment = await alphaClient.staff.createDepartment({
    orgSlug: alpha.slug,
    name: "Alpha Update Department",
  });
  const betaDepartment = await betaClient.staff.createDepartment({
    orgSlug: beta.slug,
    name: "Beta Update Department",
  });
  const alphaItem = await alphaClient.item.create(itemInput(alpha.slug, `ALPHA-${uniqueSuffix()}`));
  const betaItem = await betaClient.item.create(itemInput(beta.slug, `BETA-${uniqueSuffix()}`));
  const alphaPractitioner = await alphaClient.staff.createPractitioner({
    orgSlug: alpha.slug,
    name: "Alpha Practitioner",
    departmentId: alphaDepartment.id,
  });
  const betaPractitioner = await betaClient.staff.createPractitioner({
    orgSlug: beta.slug,
    name: "Beta Practitioner",
    departmentId: betaDepartment.id,
  });

  for (const itemId of [Bun.randomUUIDv7(), betaItem.id]) {
    await expectORPCCode(
      alphaClient.item.update({
        orgSlug: alpha.slug,
        itemId,
        name: alphaItem.name,
        code: alphaItem.code,
        category: alphaItem.category,
        unitPrice: alphaItem.unitPrice,
        taxRatePercent: alphaItem.taxRatePercent,
        taxCode: alphaItem.taxCode,
        active: true,
      }),
      "NOT_FOUND",
    );
  }
  for (const departmentId of [Bun.randomUUIDv7(), betaDepartment.id]) {
    await expectORPCCode(
      alphaClient.staff.updateDepartment({
        orgSlug: alpha.slug,
        departmentId,
        name: `Missing ${departmentId}`,
      }),
      "NOT_FOUND",
    );
  }
  for (const practitionerId of [Bun.randomUUIDv7(), betaPractitioner.id]) {
    await expectORPCCode(
      alphaClient.staff.updatePractitioner({
        orgSlug: alpha.slug,
        practitionerId,
        name: alphaPractitioner.name,
        departmentId: alphaDepartment.id,
        registrationNumber: null,
        memberUserId: null,
        consultFeeItemId: null,
      }),
      "NOT_FOUND",
    );
  }
});

test("item mutations and practitioner creates are audited, with price meta as the timeline", async () => {
  const owner = await createTestUser("item-staff-audit-owner");
  const organization = await createOrganization(owner, "item-staff-audit");
  const api = clientFor(owner);
  const item = await api.item.create(itemInput(organization.slug, `AUDIT-${uniqueSuffix()}`));
  const department = await api.staff.createDepartment({
    orgSlug: organization.slug,
    name: "Audit Department",
  });
  const practitioner = await api.staff.createPractitioner({
    orgSlug: organization.slug,
    name: "Audited Practitioner",
    departmentId: department.id,
    consultFeeItemId: item.id,
  });
  const repriced = await api.item.update({
    orgSlug: organization.slug,
    itemId: item.id,
    name: item.name,
    code: item.code,
    category: item.category,
    unitPrice: "225.00",
    taxRatePercent: item.taxRatePercent,
    taxCode: item.taxCode,
    active: true,
  });

  const entries = await eventually(async () => {
    const audit = await api.audit.list({ orgSlug: organization.slug });
    const itemEntry = audit.items.find(
      (entry) => entry.action === "item.create" && entry.target === `item:${item.id}`,
    );
    const updateEntry = audit.items.find(
      (entry) => entry.action === "item.update" && entry.target === `item:${item.id}`,
    );
    const practitionerEntry = audit.items.find(
      (entry) =>
        entry.action === "practitioner.create" &&
        entry.target === `practitioner:${practitioner.id}`,
    );
    return itemEntry && updateEntry && practitionerEntry
      ? { itemEntry, updateEntry, practitionerEntry }
      : undefined;
  });
  expect(entries.itemEntry.orgId).toBe(organization.id);
  expect(entries.practitionerEntry.orgId).toBe(organization.id);
  expect(entries.itemEntry.meta).toEqual({
    unitPrice: item.unitPrice,
    taxRatePercent: item.taxRatePercent,
    active: item.active,
  });
  expect(entries.updateEntry.meta).toEqual({
    unitPrice: repriced.unitPrice,
    taxRatePercent: repriced.taxRatePercent,
    active: repriced.active,
  });
});
