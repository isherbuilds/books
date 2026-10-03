import type { DbTransaction } from "@accly/db";
import { partyLedgerLines } from "@accly/db/schema/party-ledger-lines";
import { and, eq, inArray } from "drizzle-orm";

type PartyLedgerLineInput = Pick<
  typeof partyLedgerLines.$inferInsert,
  "partyId" | "documentId" | "side" | "kind" | "amountPaise" | "entryDate"
>;

export async function writePartyLedgerLine(
  tx: DbTransaction,
  orgId: string,
  input: PartyLedgerLineInput,
): Promise<void> {
  await tx.insert(partyLedgerLines).values({
    id: Bun.randomUUIDv7(),
    orgId,
    ...input,
  });
}

export async function reversePartyLedgerLines(
  tx: DbTransaction,
  orgId: string,
  documentIds: readonly string[],
  entryDate: string,
): Promise<void> {
  const postedLines = await tx
    .select({
      documentId: partyLedgerLines.documentId,
      partyId: partyLedgerLines.partyId,
      side: partyLedgerLines.side,
      amountPaise: partyLedgerLines.amountPaise,
    })
    .from(partyLedgerLines)
    .where(
      and(
        eq(partyLedgerLines.orgId, orgId),
        inArray(partyLedgerLines.documentId, [...documentIds]),
        eq(partyLedgerLines.kind, "post"),
      ),
    );

  if (postedLines.length === 0) return;

  await tx.insert(partyLedgerLines).values(
    postedLines.map((line) => ({
      id: Bun.randomUUIDv7(),
      orgId,
      documentId: line.documentId,
      partyId: line.partyId,
      side: line.side,
      kind: "reverse" as const,
      amountPaise: -line.amountPaise,
      entryDate,
    })),
  );
}
