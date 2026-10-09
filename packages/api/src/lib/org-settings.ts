import { db, type DbTransaction } from "@accly/db";
import { organizationSettings } from "@accly/db/schema/organization-settings";
import { eq } from "drizzle-orm";

import { impossible } from "./conflict";

export async function orgSettings(
  orgId: string,
  lock?: DbTransaction,
  mode: "share" | "update" = "share",
): Promise<typeof organizationSettings.$inferSelect> {
  const query = (lock ?? db)
    .select()
    .from(organizationSettings)
    .where(eq(organizationSettings.orgId, orgId))
    .limit(1);

  // Hold settings and lock dates stable until the writer commits. Exclusive readers
  // serialize Opening Balance posts and exception revocation against those writers.
  const [settings] = lock ? await query.for(mode) : await query;

  if (!settings) throw impossible(`organization ${orgId} is missing its settings`);

  return settings;
}

/** The Organization's time zone, which dates a cancellation and a default document date. */
export async function orgTimeZone(orgId: string): Promise<string> {
  return (await orgSettings(orgId)).timeZone;
}
