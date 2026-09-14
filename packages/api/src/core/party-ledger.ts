import type { DbTransaction } from "@accly/db";
import { partyLedgerLines } from "@accly/db/schema/party-ledger-lines";
import { and, eq } from "drizzle-orm";

export type PartyLedgerLineInput = Pick<
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
  documentId: string,
  entryDate: string,
): Promise<void> {
  const postedLines = await tx
    .select({
      partyId: partyLedgerLines.partyId,
      side: partyLedgerLines.side,
      amountPaise: partyLedgerLines.amountPaise,
    })
    .from(partyLedgerLines)
    .where(
      and(
        eq(partyLedgerLines.orgId, orgId),
        eq(partyLedgerLines.documentId, documentId),
        eq(partyLedgerLines.kind, "post"),
      ),
    );

  if (postedLines.length === 0) return;

  await tx.insert(partyLedgerLines).values(
    postedLines.map((line) => ({
      id: Bun.randomUUIDv7(),
      orgId,
      documentId,
      partyId: line.partyId,
      side: line.side,
      kind: "reverse" as const,
      amountPaise: -line.amountPaise,
      entryDate,
    })),
  );
}
