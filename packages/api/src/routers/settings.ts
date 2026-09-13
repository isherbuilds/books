import { db } from "@accly/db";
import { organizationSettings } from "@accly/db/schema/organization-settings";
import { and, eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { audit } from "../audit";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import {
  indianPinCode,
  indianStateCode,
  optionalGstin,
  pan,
  timeZone,
  validateGstinIdentity,
} from "../lib/schemas";
import { invalidateOrgSettings } from "../lib/settings-cache";

const editableSettings = {
  legalName: z.string().trim().min(1).max(200),
  pan,
  gstin: optionalGstin,
  stateCode: indianStateCode,
  addressLine1: z.string().trim().min(1).max(200),
  addressLine2: z
    .string()
    .trim()
    .max(200)
    .transform((value) => value || undefined)
    .optional(),
  city: z.string().trim().min(1).max(120),
  pinCode: indianPinCode,
  financialYearStart: z.number().int().min(1).max(12),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a three-letter currency code"),
  timeZone: timeZone,
  codePrefix: z.string().trim().max(10),
  invoicePrefix: z.string().trim().max(10),
  receiptPrefix: z.string().trim().max(10),
  creditNotePrefix: z.string().trim().max(10),
  followUpValidityDays: z.number().int().min(1).max(365),
  unbilledAlertHours: z.number().int().min(1).max(168),
};

const settingsFields = z.object(editableSettings).superRefine(validateGstinIdentity);

export type SettingsFields = z.infer<typeof settingsFields>;

function settingsDto(settings: typeof organizationSettings.$inferSelect): SettingsFields {
  return {
    legalName: settings.legalName,
    pan: settings.pan,
    gstin: settings.gstin ?? undefined,
    stateCode: settings.stateCode,
    addressLine1: settings.addressLine1,
    addressLine2: settings.addressLine2 ?? undefined,
    city: settings.city,
    pinCode: settings.pinCode,
    financialYearStart: settings.financialYearStart,
    currency: settings.currency,
    timeZone: settings.timeZone,
    codePrefix: settings.codePrefix,
    invoicePrefix: settings.invoicePrefix,
    receiptPrefix: settings.receiptPrefix,
    creditNotePrefix: settings.creditNotePrefix,
    followUpValidityDays: settings.followUpValidityDays,
    unbilledAlertHours: settings.unbilledAlertHours,
  };
}

export const settingsRouter = {
  get: orgProcedure({ settings: ["read"] }, orgInput).handler(
    async ({ context }): Promise<SettingsFields> => {
      const { orgId } = context.scope;

      const [row] = await db
        .select()
        .from(organizationSettings)
        .where(eq(organizationSettings.orgId, orgId))
        .limit(1);

      if (!row) {
        throw new ORPCError("NOT_FOUND", { message: "Organization settings not found" });
      }

      return settingsDto(row);
    },
  ),

  update: orgProcedure(
    { settings: ["update"] },
    orgInput.extend(editableSettings).superRefine(validateGstinIdentity),
  ).handler(async ({ context, input }): Promise<SettingsFields> => {
    const { scope } = context;
    const { orgSlug: _claim, currency, ...settings } = input;

    const [saved] = await db
      .update(organizationSettings)
      .set({
        ...settings,
        gstin: settings.gstin ?? null,
        addressLine2: settings.addressLine2 ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(organizationSettings.orgId, scope.orgId),
          eq(organizationSettings.currency, currency),
        ),
      )
      .returning();

    if (!saved) {
      throw new ORPCError("CONFLICT", {
        message: "Organization settings changed; reload and try again",
      });
    }

    // Derived reads must see the new prefixes on the next call in this process.
    invalidateOrgSettings(scope.orgId);

    audit({
      action: "settings.update",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `settings:${scope.orgId}`,
    });

    return settingsDto(saved);
  }),
};
