import type { db, DbTransaction } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import type { AccountType } from "@accly/db/schema/account-kinds";
import { items as itemTable } from "@accly/db/schema/items";
import type { organizationSettings } from "@accly/db/schema/organization-settings";
import { parties } from "@accly/db/schema/parties";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import { isLeaf, journalAccounts } from "../lib/accounts";
import { businessDate } from "../lib/business-date";
import {
  SHEET_ORDER,
  type ImportWorkbook,
  type ImportError,
  type SheetName,
} from "../lib/import-workbook";
import { normalizedName } from "../lib/normalized-name";
import { deriveFromGstin } from "../lib/schemas";
import {
  accountCodeAllocator,
  accountSupplyError,
  itemEligibilityError,
  accountCreateFields,
  itemFields,
  partyInputFields,
  type AccountCreateInput,
  type ItemFields,
  type PartyFields,
} from "./masters";
import { formatMoney } from "./money";
import {
  assertNoOpeningBalance,
  controlNets,
  type OpeningItem,
  type OpeningLine,
} from "./opening-items";
import { ratesByCode } from "./tax-schedule";

const MAX_ERRORS = 500;

type ImportSummary = {
  accounts: number;
  parties: number;
  items: number;
  trialBalanceRows: number;
  openingClaims: number;
  openingCredits: number;
  debitPaise: bigint;
  creditPaise: bigint;
  receivablesPaise: bigint;
  payablesPaise: bigint;
};

/**
 * The writes of a valid workbook. New masters carry ids assigned here, so later rows
 * reference them before they are written.
 */
export type ImportPlan = {
  accounts: AccountCreateInput[];
  parties: (PartyFields & { id: string })[];
  items: (ItemFields & { id: string })[];
  opening: { documentDate: string; lines: OpeningLine[]; items: OpeningItem[] } | null;
};

type ResolvedAccount = {
  id: string;
  /** Created by this workbook, so not yet in the database to admit. */
  isNew: boolean;
  type: AccountType;
  supplyClass: AccountCreateInput["supplyClass"] | null;
  isLeaf: boolean;
  systemKey: string | null;
};

const accountSchema = z.object(accountCreateFields).omit({ parent: true });

const partySchema = z.object(partyInputFields).transform(deriveFromGstin);

const itemSchema = z.object(itemFields).omit({ incomeAccountId: true, unitPrice: true });

const TYPE_LABELS: Record<string, AccountType> = {
  assets: "asset",
  liabilities: "liability",
  equity: "equity",
  income: "income",
  expenses: "expense",
};

const FIELD_COLUMNS: Record<string, string> = {
  name: "Name",
  parent: "Parent",
  supplyClass: "GST supply class",
  roles: "Roles",
  gstin: "GSTIN",
  pan: "PAN",
  stateCode: "State code",
  address: "Address",
  city: "City",
  pinCode: "PIN code",
  email: "Email",
  phone: "Phone",
  hsnSac: "HSN/SAC",
  unit: "Unit",
  taxCode: "Tax code",
};

/**
 * Resolves and checks the workbook against the Organization without writing. Commit
 * runs it again inside its transaction, so `plan` is what that transaction posts.
 * Opening data beside a posted Opening Balance is `CONFLICT`.
 */
export async function validateImport(
  tx: DbTransaction | typeof db,
  orgId: string,
  settings: Pick<typeof organizationSettings.$inferSelect, "gstin" | "timeZone">,
  { workbook, errors: readErrors }: { workbook: ImportWorkbook; errors: readonly ImportError[] },
): Promise<{
  errors: ImportError[];
  errorCount: number;
  summary: ImportSummary;
  /** Null while any error remains. */
  plan: ImportPlan | null;
}> {
  const errors = [...readErrors];

  const error = (
    sheet: SheetName | null,
    row: number | null,
    column: string | null,
    code: string,
    message: string,
  ) => errors.push({ sheet, row, column, code, message });

  const fieldErrors = (sheet: SheetName, row: number, issues: readonly z.core.$ZodIssue[]) => {
    for (const issue of issues)
      error(
        sheet,
        row,
        FIELD_COLUMNS[String(issue.path[0])] ?? null,
        "CELL_INVALID",
        issue.message,
      );
  };

  const plan: ImportPlan = { accounts: [], parties: [], items: [], opening: null };
  const today = businessDate(new Date(), settings.timeZone);

  const hasOpening = workbook.trialBalance.length > 0 || workbook.openingItems.length > 0;

  if (hasOpening) await assertNoOpeningBalance(tx, orgId);

  if (hasOpening && workbook.openingDate === null && !errors.some((row) => row.sheet === "Opening"))
    error("Opening", null, "Opening date", "OPENING_DATE_REQUIRED", "Enter the opening date.");

  if (hasOpening && workbook.openingDate !== null && workbook.openingDate > today)
    error(
      "Opening",
      2,
      "Opening date",
      "OPENING_BALANCE_DATE_FUTURE",
      "Choose the day before your cutover, not a future date.",
    );

  // Include inactive codes for allocation, but only active accounts for references.
  const needsAccounts =
    workbook.accounts.length > 0 || workbook.items.length > 0 || workbook.trialBalance.length > 0;

  const orgAccounts = !needsAccounts
    ? []
    : await tx
        .select({
          id: accounts.id,
          code: accounts.code,
          name: accounts.name,
          type: accounts.type,
          systemKey: accounts.systemKey,
          supplyClass: accounts.supplyClass,
          active: accounts.active,
          isLeaf: sql<boolean>`${isLeaf(orgId)}`,
        })
        .from(accounts)
        .where(eq(accounts.orgId, orgId));

  const activeAccounts = orgAccounts.filter((account) => account.active);
  const byCode = new Map(activeAccounts.map((account) => [account.code.toLowerCase(), account]));
  const byName = new Map(activeAccounts.map((account) => [account.name.toLowerCase(), account]));
  const accountNames = new Set(byName.keys());
  const allocateCode = accountCodeAllocator(orgAccounts);

  const workbookAccounts = new Map<string, ResolvedAccount>();

  for (const row of workbook.accounts) {
    const parsed = accountSchema.safeParse(row);

    if (!parsed.success) {
      fieldErrors("Accounts", row.row, parsed.error.issues);
      continue;
    }

    const key = parsed.data.name.toLowerCase();

    if (accountNames.has(key))
      error(
        "Accounts",
        row.row,
        "Name",
        "ACCOUNT_NAME_TAKEN",
        "An account with this name already exists.",
      );
    accountNames.add(key);

    const parentKey = row.parent.toLowerCase();
    const parent = byCode.get(parentKey) ?? byName.get(parentKey);
    const rootType = Object.hasOwn(TYPE_LABELS, parentKey) ? TYPE_LABELS[parentKey] : undefined;

    if (!parent && !rootType) {
      error(
        "Accounts",
        row.row,
        "Parent",
        "ACCOUNT_UNKNOWN",
        `No active account group or type is named ${row.parent}.`,
      );
      continue;
    }

    if (parent?.isLeaf) {
      error(
        "Accounts",
        row.row,
        "Parent",
        "ACCOUNT_PARENT_INVALID",
        "Choose an active account group.",
      );
      continue;
    }

    const type = parent ? parent.type : rootType!;
    const supplyClass = parsed.data.supplyClass;

    const supplyError = accountSupplyError(type, supplyClass);

    if (supplyError)
      error("Accounts", row.row, "GST supply class", supplyError.code, supplyError.message);

    if (allocateCode(type, parent) === null)
      error(
        "Accounts",
        row.row,
        "Parent",
        "ACCOUNT_CODES_FULL",
        "This account type or group has no free account codes.",
      );

    const id = Bun.randomUUIDv7();
    plan.accounts.push({
      ...parsed.data,
      id,
      parent: parent ? { accountId: parent.id } : { type },
    });

    if (!workbookAccounts.has(key))
      workbookAccounts.set(key, {
        id,
        isNew: true,
        type,
        supplyClass: supplyClass ?? null,
        isLeaf: true,
        systemKey: null,
      });
  }

  const resolveAccount = (name: string): ResolvedAccount | undefined => {
    const key = name.toLowerCase();
    const existing = byCode.get(key) ?? byName.get(key);

    return existing ? { ...existing, isNew: false } : workbookAccounts.get(key);
  };

  const referencedNames = [
    ...new Set([
      ...workbook.parties.map((row) => normalizedName(row.name)),
      ...workbook.openingItems.map((row) => normalizedName(row.party)),
    ]),
  ];

  const incomingGstins = [
    ...new Set(workbook.parties.flatMap((row) => (row.gstin ? [row.gstin.toUpperCase()] : []))),
  ];

  const orgParties =
    referencedNames.length === 0 && incomingGstins.length === 0
      ? []
      : await tx
          .select({
            id: parties.id,
            normalizedName: parties.normalizedName,
            gstin: parties.gstin,
            active: parties.active,
          })
          .from(parties)
          .where(
            and(
              eq(parties.orgId, orgId),
              or(
                referencedNames.length > 0
                  ? inArray(parties.normalizedName, referencedNames)
                  : undefined,
                incomingGstins.length > 0 ? inArray(parties.gstin, incomingGstins) : undefined,
              ),
            ),
          );

  // Party ids by normalized name; a name with two ids is ambiguous.
  const partiesByName = new Map<string, string[]>();

  const addParty = (key: string, id: string) =>
    partiesByName.set(key, [...(partiesByName.get(key) ?? []), id]);

  for (const party of orgParties) addParty(party.normalizedName, party.id);

  // Receipts and Payments refuse an inactive party, so its items could never settle.
  const inactive = new Set(orgParties.flatMap((party) => (party.active ? [] : [party.id])));

  const partyNames = new Set(partiesByName.keys());
  const gstins = new Set(orgParties.flatMap((party) => (party.gstin ? [party.gstin] : [])));

  for (const row of workbook.parties) {
    const key = normalizedName(row.name);

    if (partyNames.has(key))
      error(
        "Parties",
        row.row,
        "Name",
        "PARTY_NAME_COLLISION",
        "A party with this name already exists.",
      );
    partyNames.add(key);
    const id = Bun.randomUUIDv7();
    addParty(key, id);
    const parsed = partySchema.safeParse(row);

    if (!parsed.success) {
      fieldErrors("Parties", row.row, parsed.error.issues);
      continue;
    }

    if (parsed.data.gstin) {
      if (gstins.has(parsed.data.gstin))
        error(
          "Parties",
          row.row,
          "GSTIN",
          "PARTY_GSTIN_TAKEN",
          "A party with this GSTIN already exists.",
        );
      gstins.add(parsed.data.gstin);
    }

    plan.parties.push({ ...parsed.data, id });
  }

  const incomingItemNames = [...new Set(workbook.items.map((row) => normalizedName(row.name)))];

  const orgItems =
    incomingItemNames.length === 0
      ? []
      : await tx
          .select({ normalizedName: itemTable.normalizedName })
          .from(itemTable)
          .where(
            and(eq(itemTable.orgId, orgId), inArray(itemTable.normalizedName, incomingItemNames)),
          );

  const itemNames = new Set(orgItems.map((item) => item.normalizedName));

  const taxRates = await ratesByCode(
    tx,
    orgId,
    [
      ...new Set(
        workbook.items.flatMap((item) => (item.taxCode ? [item.taxCode.toUpperCase()] : [])),
      ),
    ],
    today,
  );

  for (const row of workbook.items) {
    const key = normalizedName(row.name);

    if (itemNames.has(key))
      error("Items", row.row, "Name", "ITEM_NAME_TAKEN", "An item with that name already exists.");
    itemNames.add(key);
    const parsed = itemSchema.safeParse(row);

    if (!parsed.success) fieldErrors("Items", row.row, parsed.error.issues);
    const account = resolveAccount(row.incomeAccount);

    if (!account) {
      error(
        "Items",
        row.row,
        "Income account",
        "ACCOUNT_UNKNOWN",
        `No active account has the code or name ${row.incomeAccount}.`,
      );
      continue;
    }

    if (!parsed.success) continue;

    const eligible = account.type === "income" && account.isLeaf && account.systemKey === null;

    const eligibilityError = itemEligibilityError(
      eligible ? { supplyClass: account.supplyClass ?? null } : undefined,
      parsed.data.hsnSac,
      parsed.data.taxCode,
      parsed.data.taxCode !== undefined && taxRates.has(parsed.data.taxCode),
    );

    if (eligibilityError)
      error(
        "Items",
        row.row,
        eligibilityError.code === "INCOME_ACCOUNT_INVALID"
          ? "Income account"
          : eligibilityError.code === "HSN_SAC_REQUIRED"
            ? "HSN/SAC"
            : "Tax code",
        eligibilityError.code,
        eligibilityError.message,
      );

    plan.items.push({
      ...parsed.data,
      id: Bun.randomUUIDv7(),
      unitPrice: row.unitPricePaise,
      incomeAccountId: account.id,
    });
  }

  const referenced = new Map<ImportWorkbook["trialBalance"][number], ResolvedAccount>();

  for (const row of workbook.trialBalance) {
    const account = resolveAccount(row.account);

    if (account) referenced.set(row, account);
    else
      error(
        "Trial balance",
        row.row,
        "Account",
        "ACCOUNT_UNKNOWN",
        `No active account has the code or name ${row.account}.`,
      );
  }

  const existingIds = [
    ...new Set([...referenced.values()].flatMap((account) => (account.isNew ? [] : [account.id]))),
  ];

  const admitted =
    existingIds.length === 0
      ? []
      : await journalAccounts(tx, orgId, {
          gstin: null,
          ids: existingIds,
          controls: ["receivables", "payables"],
        });

  const admittedById = new Map(admitted.map((account) => [account.id, account]));

  const lines: OpeningLine[] = [];
  let receivablesRowPaise = 0n;
  let payablesRowPaise = 0n;
  let debitPaise = 0n;
  let creditPaise = 0n;

  for (const row of workbook.trialBalance) {
    debitPaise += row.debitPaise;
    creditPaise += row.creditPaise;

    const resolved = referenced.get(row);

    if (!resolved) continue;

    const account = resolved.isNew ? resolved : admittedById.get(resolved.id);

    if (!account) {
      error(
        "Trial balance",
        row.row,
        "Account",
        "ACCOUNT_INVALID",
        `${row.account} cannot take an opening balance: choose an active leaf other than an advance account.`,
      );
      continue;
    }

    if (account.systemKey === "receivables") {
      receivablesRowPaise += row.debitPaise - row.creditPaise;
      continue;
    }

    if (account.systemKey === "payables") {
      payablesRowPaise += row.creditPaise - row.debitPaise;
      continue;
    }

    if (settings.gstin !== null && account.supplyClass === "taxable") {
      error(
        "Trial balance",
        row.row,
        "Account",
        "TAXABLE_ACCOUNT_LINE",
        `${row.account} is taxable income, which is invoiced: carry its balance in another leaf.`,
      );
      continue;
    }

    lines.push(
      row.debitPaise > 0n
        ? { accountId: resolved.id, side: "debit", amount: row.debitPaise }
        : { accountId: resolved.id, side: "credit", amount: row.creditPaise },
    );
  }

  if (debitPaise !== creditPaise)
    error(
      "Trial balance",
      null,
      null,
      "TRIAL_BALANCE_UNEQUAL",
      `Debits ${formatMoney(debitPaise)} and credits ${formatMoney(creditPaise)} differ.`,
    );

  const openingItems: OpeningItem[] = [];

  for (const row of workbook.openingItems) {
    const found = partiesByName.get(normalizedName(row.party)) ?? [];

    if (found.length !== 1) {
      error(
        "Opening items",
        row.row,
        "Party",
        found.length === 0 ? "PARTY_UNKNOWN" : "PARTY_AMBIGUOUS",
        found.length === 0
          ? `No party is named ${row.party}.`
          : `${found.length} parties are named ${row.party}: rename one first.`,
      );
      continue;
    }

    if (inactive.has(found[0]!)) {
      error(
        "Opening items",
        row.row,
        "Party",
        "PARTY_INACTIVE",
        `${row.party} is inactive: mark it active first.`,
      );
      continue;
    }

    if (workbook.openingDate !== null && row.documentDate > workbook.openingDate) {
      error(
        "Opening items",
        row.row,
        "Date",
        "ITEM_DATE_AFTER_OPENING",
        "Enter a date on or before the opening date.",
      );
      continue;
    }

    openingItems.push({
      partyId: found[0]!,
      side: row.side,
      type: row.type,
      reference: row.reference,
      documentDate: row.documentDate,
      dueDate: row.dueDate,
      amountPaise: row.amountPaise,
    });
  }

  // Incomplete opening-item rows cannot be reconciled against the trial balance.
  // Wait for their cell/domain errors to be fixed before comparing either control.
  const openingItemsHaveErrors = errors.some((entry) => entry.sheet === "Opening items");
  const { receivablesPaise, payablesPaise } = controlNets(workbook.openingItems);

  if (hasOpening) {
    if (!openingItemsHaveErrors && receivablesRowPaise !== receivablesPaise)
      error(
        "Trial balance",
        null,
        null,
        "OPENING_ITEMS_MISMATCH",
        `Accounts receivable is ${formatMoney(receivablesRowPaise)} but the receivable items net to ${formatMoney(receivablesPaise)}.`,
      );

    if (!openingItemsHaveErrors && payablesRowPaise !== payablesPaise)
      error(
        "Trial balance",
        null,
        null,
        "OPENING_ITEMS_MISMATCH",
        `Accounts payable is ${formatMoney(payablesRowPaise)} but the payable items net to ${formatMoney(payablesPaise)}.`,
      );

    if (lines.length === 0 && receivablesPaise === 0n && payablesPaise === 0n)
      error(
        "Trial balance",
        null,
        null,
        "TRIAL_BALANCE_EMPTY",
        "Enter the trial balance as at the opening date.",
      );
  }

  errors.sort(
    (a, b) =>
      (a.sheet === null ? -1 : SHEET_ORDER.indexOf(a.sheet)) -
        (b.sheet === null ? -1 : SHEET_ORDER.indexOf(b.sheet)) || (a.row ?? 0) - (b.row ?? 0),
  );

  const summary: ImportSummary = {
    accounts: workbook.accounts.length,
    parties: workbook.parties.length,
    items: workbook.items.length,
    trialBalanceRows: workbook.trialBalance.length,
    openingClaims: workbook.openingItems.filter((row) => row.type === "openingClaim").length,
    openingCredits: workbook.openingItems.filter((row) => row.type === "openingCredit").length,
    debitPaise,
    creditPaise,
    receivablesPaise,
    payablesPaise,
  };

  if (hasOpening && workbook.openingDate !== null)
    plan.opening = { documentDate: workbook.openingDate, lines, items: openingItems };

  return {
    errors: errors.slice(0, MAX_ERRORS),
    errorCount: errors.length,
    summary,
    plan: errors.length > 0 ? null : plan,
  };
}
