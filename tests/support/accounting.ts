import type { AppRouterClient } from "@accly/api/routers/index";
import { db } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { journalEntries } from "@accly/db/schema/journal-entries";
import { journalLines } from "@accly/db/schema/journal-lines";
import { partyLedgerLines } from "@accly/db/schema/party-ledger-lines";
import { and, eq } from "drizzle-orm";

import { required } from "./assert";
import {
  createAccountingOrganization,
  createTestUser,
  joinOrganization,
  type TestUser,
} from "./auth";
import { clientFor } from "./client";
import { uniqueSuffix } from "./unique";

type AccountingOrganizationInput = Parameters<AppRouterClient["organization"]["create"]>[0];

// One organization with an accountant client, its seeded chart and its Payment Methods.
export async function createAccountingFixture(
  founder: TestUser,
  prefix: string,
  overrides: Partial<AccountingOrganizationInput> = {},
) {
  const organization = await createAccountingOrganization(founder.headers, {
    slug: `${prefix}-${uniqueSuffix()}`,
    timeZone: "UTC",
    ...overrides,
  });

  const accountant = await createTestUser(`${prefix}-accountant-${uniqueSuffix()}`);
  await joinOrganization(accountant, organization.id, "accountant");

  const api = clientFor(accountant);

  const [seededAccounts, methods] = await Promise.all([
    db.select().from(accounts).where(eq(accounts.orgId, organization.id)),
    api.paymentMethod.list({ orgSlug: organization.slug }),
  ]);

  return { organization, accountant, api, accounts: seededAccounts, methods };
}

// The journal entry a document's post or reversal wrote, with its lines and every
// party ledger line the document carries.
export async function postingOf(orgId: string, documentId: string, kind: "post" | "reverse") {
  const [row] = await db
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.orgId, orgId),
        eq(journalEntries.documentId, documentId),
        eq(journalEntries.kind, kind),
      ),
    );

  const entry = required(row, `${kind} entry for document ${documentId}`);

  const [lines, ledger] = await Promise.all([
    db
      .select()
      .from(journalLines)
      .where(and(eq(journalLines.orgId, orgId), eq(journalLines.entryId, entry.id))),
    db
      .select()
      .from(partyLedgerLines)
      .where(and(eq(partyLedgerLines.orgId, orgId), eq(partyLedgerLines.documentId, documentId))),
  ]);

  return { entry, lines, ledger };
}
