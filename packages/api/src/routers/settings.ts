import { db } from "@accly/db";
import { organizationSettings } from "@accly/db/schema/organization-settings";
import { eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { audit } from "../audit";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import {
  documentPrefix,
  indianPinCode,
  indianStateCode,
  optionalGstin,
  pan,
  timeZone,
  validateGstinIdentity,
} from "../lib/schemas";

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
  timeZone: timeZone,
  invoicePrefix: documentPrefix,
  receiptPrefix: documentPrefix,
  paymentPrefix: documentPrefix,
  creditNotePrefix: documentPrefix,
  journalPrefix: documentPrefix,
};

const settingsFields = z.object(editableSettings).superRefine(validateGstinIdentity);

export type SettingsFields = z.infer<typeof settingsFields>;

const NOT_FOUND_MESSAGE = "Organization settings not found";

function settingsDto(settings: typeof organizationSettings.$inferSelect): SettingsFields {
  const {
    orgId: _orgId,
    legalType: _legalType,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...rest
  } = settings;

  return {
    ...rest,
    gstin: settings.gstin ?? undefined,
    addressLine2: settings.addressLine2 ?? undefined,
  };
}

export const settingsRouter = {
  get: orgProcedure({ settings: ["read"] }, orgInput).handler(
    async ({ context }): Promise<SettingsFields> => {
      const [row] = await db
        .select()
        .from(organizationSettings)
        .where(eq(organizationSettings.orgId, context.scope.orgId))
        .limit(1);

      if (!row) throw new ORPCError("NOT_FOUND", { message: NOT_FOUND_MESSAGE });

      return settingsDto(row);
    },
  ),

  update: orgProcedure(
    { settings: ["update"] },
    orgInput.extend(editableSettings).superRefine(validateGstinIdentity),
  ).handler(async ({ context, input }): Promise<SettingsFields> => {
    const { scope } = context;
    const { orgSlug: _claim, ...settings } = input;

    const [saved] = await db
      .update(organizationSettings)
      .set({
        ...settings,
        gstin: settings.gstin ?? null,
        addressLine2: settings.addressLine2 ?? null,
        updatedAt: new Date(),
      })
      .where(eq(organizationSettings.orgId, scope.orgId))
      .returning();

    if (!saved) throw new ORPCError("NOT_FOUND", { message: NOT_FOUND_MESSAGE });

    audit({
      action: "settings.update",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `settings:${scope.orgId}`,
    });

    return settingsDto(saved);
  }),
};
