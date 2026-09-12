import { db } from "@accly/db";
import { organizationSettings } from "@accly/db/schema/organization-settings";
import { eq } from "drizzle-orm";

import { INDIAN_STATES } from "./indian-states";

type StoredSettings = Pick<
  typeof organizationSettings.$inferSelect,
  | "currency"
  | "timeZone"
  | "codePrefix"
  | "invoicePrefix"
  | "receiptPrefix"
  | "creditNotePrefix"
  | "followUpValidityDays"
  | "unbilledAlertHours"
>;

type OrgSettings = StoredSettings & {
  address: string;
  fiscalYearStartMonth: number;
  legalName: string;
  taxId: string;
};

// Server-side derived reads only (numbering prefixes, print headers), where a
// bounded staleness window is acceptable. Membership is NEVER cached.
export const SETTINGS_CACHE_TTL_MS = 60 * 60 * 1000;

const cache = new Map<string, { value: OrgSettings; expiresAt: number }>();

// Bumped by every invalidation, so a SELECT that started before a write cannot
// land its stale snapshot in the cache after the write cleared it.
const generation = new Map<string, number>();

// `now` is a test seam for the expiry contract; production never passes it.
export async function readOrgSettings(
  orgId: string,
  now: number = Date.now(),
): Promise<OrgSettings> {
  const hit = cache.get(orgId);

  if (hit && hit.expiresAt > now) {
    return hit.value;
  }

  const seen = generation.get(orgId) ?? 0;

  const [row] = await db
    .select()
    .from(organizationSettings)
    .where(eq(organizationSettings.orgId, orgId))
    .limit(1);

  if (!row) {
    throw new Error(`Organization ${orgId} is missing its settings`);
  }

  const stateName = INDIAN_STATES[row.stateCode];

  if (!stateName) {
    throw new Error(`Organization ${orgId} has invalid state code ${row.stateCode}`);
  }

  const address = [row.addressLine1, row.addressLine2, row.city, stateName, row.pinCode]
    .filter((part): part is string => Boolean(part))
    .join(", ");

  const value: OrgSettings = {
    currency: row.currency,
    timeZone: row.timeZone,
    codePrefix: row.codePrefix,
    invoicePrefix: row.invoicePrefix,
    receiptPrefix: row.receiptPrefix,
    creditNotePrefix: row.creditNotePrefix,
    followUpValidityDays: row.followUpValidityDays,
    unbilledAlertHours: row.unbilledAlertHours,
    address,
    fiscalYearStartMonth: row.financialYearStart,
    legalName: row.legalName,
    taxId: row.gstin ?? row.pan,
  };

  if ((generation.get(orgId) ?? 0) === seen) {
    cache.set(orgId, { value, expiresAt: now + SETTINGS_CACHE_TTL_MS });
  }

  return value;
}

export function invalidateOrgSettings(orgId: string): void {
  cache.delete(orgId);
  generation.set(orgId, (generation.get(orgId) ?? 0) + 1);
}
