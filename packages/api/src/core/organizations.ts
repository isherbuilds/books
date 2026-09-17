import { organizationSlugIssue } from "@accly/auth/organization-slug";
import { db } from "@accly/db";
import { member, organization } from "@accly/db/schema/auth";
import {
  LEGAL_TYPES,
  SETTINGS_DEFAULTS,
  organizationSettings,
} from "@accly/db/schema/organization-settings";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { uniqueViolationConstraint } from "../lib/db-errors";
import {
  indianPinCode,
  indianStateCode,
  optionalGstin,
  pan,
  shortName,
  timeZone,
  validateGstinIdentity,
} from "../lib/schemas";
import { seedChartOfAccounts } from "./chart-templates";
import { seedTaxRates } from "./tax-schedule";
import { seedTdsSections } from "./tds-schedule";

export const createOrganizationInput = z
  .object({
    name: shortName.max(120),
    slug: z.string().trim(),
    legalType: z.enum(LEGAL_TYPES),
    legalName: z.string().trim().min(1).max(200),
    pan,
    gstin: optionalGstin,
    stateCode: indianStateCode,
    financialYearStart: z.number().int().min(1).max(12).default(4),
    timeZone: timeZone.default(SETTINGS_DEFAULTS.timeZone),
    addressLine1: z.string().trim().min(1).max(200),
    addressLine2: z
      .string()
      .trim()
      .max(200)
      .transform((value) => value || undefined)
      .optional(),
    city: z.string().trim().min(1).max(120),
    pinCode: indianPinCode,
  })
  .superRefine(validateGstinIdentity);

// Internal bootstrap for authenticated routes and trusted seed/test callers.
export async function createOrganization(
  ownerUserId: string,
  input: z.infer<typeof createOrganizationInput>,
) {
  const slugIssue = organizationSlugIssue(input.slug);

  if (slugIssue) {
    throw new ORPCError("BAD_REQUEST", { message: slugIssue });
  }

  const id = Bun.randomUUIDv7();
  const createdAt = new Date();
  const pan = input.pan.toUpperCase();
  const gstin = input.gstin?.toUpperCase() ?? null;

  try {
    await db.transaction(async (tx) => {
      await tx.insert(organization).values({
        id,
        name: input.name,
        slug: input.slug,
        createdAt,
      });
      await tx.insert(member).values({
        id: Bun.randomUUIDv7(),
        organizationId: id,
        userId: ownerUserId,
        role: "owner",
        createdAt,
      });
      await tx.insert(organizationSettings).values({
        ...SETTINGS_DEFAULTS,
        timeZone: input.timeZone,
        orgId: id,
        legalType: input.legalType,
        legalName: input.legalName,
        pan,
        gstin,
        stateCode: input.stateCode,
        financialYearStart: input.financialYearStart,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2 ?? null,
        city: input.city,
        pinCode: input.pinCode,
      });
      await seedChartOfAccounts(tx, id, input.legalType);
      await seedTaxRates(tx, id);
      await seedTdsSections(tx, id);
    });
  } catch (error) {
    if (uniqueViolationConstraint(error) === "organization_slug_uidx") {
      throw new ORPCError("CONFLICT", {
        message: "That organization URL is already in use.",
      });
    }

    throw error;
  }

  return { id, slug: input.slug };
}
