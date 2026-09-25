import { db } from "@accly/db";
import { documents } from "@accly/db/schema/documents";
import { organizationSettings } from "@accly/db/schema/organization-settings";
import { and, eq, isNotNull } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { audit } from "../audit";
import { badRequest, impossible } from "../lib/conflict";
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
  billPrefix: documentPrefix,
  receiptPrefix: documentPrefix,
  paymentPrefix: documentPrefix,
  creditNotePrefix: documentPrefix,
  debitNotePrefix: documentPrefix,
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
    lockedThrough: _lockedThrough,
    taxLockedThrough: _taxLockedThrough,
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

    const saved = await db.transaction(async (tx) => {
      // FOR UPDATE waits out every posting, which reads settings FOR SHARE, so no
      // document is numbered between this check and the write.
      const [current] = await tx
        .select({ financialYearStart: organizationSettings.financialYearStart })
        .from(organizationSettings)
        .where(eq(organizationSettings.orgId, scope.orgId))
        .for("update");

      if (!current) throw new ORPCError("NOT_FOUND", { message: NOT_FOUND_MESSAGE });

      // The start month names every financial year and its number series, so moving
      // it after a document is numbered would split one GST year across two series.
      if (current.financialYearStart !== settings.financialYearStart) {
        const [numbered] = await tx
          .select({ id: documents.id })
          .from(documents)
          .where(and(eq(documents.orgId, scope.orgId), isNotNull(documents.number)))
          .limit(1);

        if (numbered) {
          throw badRequest(
            "FINANCIAL_YEAR_FIXED",
            "The fiscal year start cannot change after a document is numbered.",
          );
        }
      }

      const [row] = await tx
        .update(organizationSettings)
        .set({
          ...settings,
          gstin: settings.gstin ?? null,
          addressLine2: settings.addressLine2 ?? null,
          updatedAt: new Date(),
        })
        .where(eq(organizationSettings.orgId, scope.orgId))
        .returning();

      if (!row) throw impossible("locked organization settings disappeared");

      return row;
    });

    audit({
      action: "settings.update",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `settings:${scope.orgId}`,
    });

    return settingsDto(saved);
  }),
};
