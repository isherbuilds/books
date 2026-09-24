import { db, type DbTransaction } from "@accly/db";
import { parties } from "@accly/db/schema/parties";
import { and, eq } from "drizzle-orm";

/**
 * The active Party a document names, or null. Inside a posting transaction the row
 * is share-locked, so an archive waits for the post to commit; a draft save reads
 * through `db` and takes no lock.
 */
export async function activeParty(
  executor: typeof db | DbTransaction,
  orgId: string,
  partyId: string,
): Promise<typeof parties.$inferSelect | null> {
  const query = executor
    .select()
    .from(parties)
    .where(and(eq(parties.orgId, orgId), eq(parties.id, partyId), eq(parties.active, true)))
    .limit(1);

  const [party] = await (executor === db ? query : query.for("share"));

  return party ?? null;
}
