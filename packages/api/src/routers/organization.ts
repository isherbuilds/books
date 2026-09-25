import { db } from "@accly/db";
import { organizationSettings } from "@accly/db/schema/organization-settings";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { audit } from "../audit";
import { createOrganization, createOrganizationInput } from "../core/organizations";
import { isFounder } from "../lib/founder";
import { orgInput, orgProcedure, sessionProcedure } from "../lib/procedures/factory";

export const organizationRouter = {
  create: sessionProcedure.input(createOrganizationInput).handler(async ({ context, input }) => {
    const { session } = context;

    if (!isFounder(session.user.email)) {
      throw new ORPCError("FORBIDDEN", {
        message: "Only the founding account can create organizations.",
      });
    }

    const created = await createOrganization(session.user.id, input);

    audit({
      action: "organization.create",
      actorId: session.user.id,
      orgId: created.id,
      target: `organization:${created.id}`,
      meta: { legalType: input.legalType, slug: input.slug },
    });

    return created;
  }),

  // `/join` has no organization yet, so the founder check is session-level here.
  canCreate: sessionProcedure.handler(({ context }) => isFounder(context.session.user.email)),

  getProfile: orgProcedure({ settings: ["read"] }, orgInput).handler(async ({ context }) => {
    const { scope } = context;

    const [row] = await db
      .select({
        orgId: organizationSettings.orgId,
        legalType: organizationSettings.legalType,
        legalName: organizationSettings.legalName,
        pan: organizationSettings.pan,
        gstin: organizationSettings.gstin,
        stateCode: organizationSettings.stateCode,
        financialYearStart: organizationSettings.financialYearStart,
        addressLine1: organizationSettings.addressLine1,
        addressLine2: organizationSettings.addressLine2,
        city: organizationSettings.city,
        pinCode: organizationSettings.pinCode,
        createdAt: organizationSettings.createdAt,
        updatedAt: organizationSettings.updatedAt,
        timeZone: organizationSettings.timeZone,
      })
      .from(organizationSettings)
      .where(eq(organizationSettings.orgId, scope.orgId))
      .limit(1);

    if (!row) {
      throw new ORPCError("NOT_FOUND", { message: "Organization profile not found." });
    }

    return row;
  }),
};
