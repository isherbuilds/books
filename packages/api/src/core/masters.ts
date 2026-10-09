import type { DbTransaction } from "@accly/db";
import { ACCOUNT_TYPES, SUPPLY_CLASSES, type AccountType } from "@accly/db/schema/account-kinds";
import { accounts } from "@accly/db/schema/accounts";
import { items } from "@accly/db/schema/items";
import { MONEY_KINDS } from "@accly/db/schema/money-kinds";
import { PARTY_ROLES, parties } from "@accly/db/schema/parties";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { isLeaf, postableAccounts } from "../lib/accounts";
import { badRequest, conflict } from "../lib/conflict";
import { uniqueViolationConstraint } from "../lib/db-errors";
import { insertChunks } from "../lib/insert-chunks";
import { normalizedName } from "../lib/normalized-name";
import {
  indianPinCode,
  masterName,
  money,
  optionalGstin,
  optionalHsnSac,
  optionalPan,
  optionalStateCode,
  optionalTaxCode,
  positiveMoney,
  shortName,
} from "../lib/schemas";
import { ratesByCode } from "./tax-schedule";

export const partyInputFields = {
  name: masterName,
  roles: z
    .array(z.enum(PARTY_ROLES))
    .min(1)
    .refine((roles) => new Set(roles).size === roles.length, "Party roles must be unique"),
  gstin: optionalGstin,
  pan: optionalPan,
  stateCode: optionalStateCode,
  address: z.string().trim().min(1).max(500).optional(),
  city: z.string().trim().min(1).max(120).optional(),
  pinCode: indianPinCode.optional(),
  email: z.email().optional(),
  phone: z.string().trim().min(1).max(30).optional(),
};

export type PartyFields = z.infer<z.ZodObject<typeof partyInputFields>> & { stateCode: string };

export function partyValues(fields: PartyFields) {
  return {
    ...fields,
    normalizedName: normalizedName(fields.name),
    gstin: fields.gstin ?? null,
    pan: fields.pan ?? null,
    address: fields.address ?? null,
    city: fields.city ?? null,
    pinCode: fields.pinCode ?? null,
    email: fields.email ?? null,
    phone: fields.phone ?? null,
  };
}

/**
 * Serializes an Organization's party writers with one advisory lock, then refuses a
 * namesake (unless the caller confirmed it) and a taken GSTIN. One Party per GSTIN is
 * an application rule, not a unique index. One lock keeps a 5,000-party import inside
 * PostgreSQL's shared lock table.
 */
export async function claimParties(
  tx: DbTransaction,
  orgId: string,
  rows: readonly { normalizedName: string; gstin: string | null }[],
  allowNamesake: boolean,
  exceptId?: string,
): Promise<void> {
  const names = rows.map((row) => row.normalizedName);
  const gstins = rows.flatMap((row) => (row.gstin ? [row.gstin] : []));

  if (!allowNamesake && new Set(names).size !== names.length)
    throw conflict("PARTY_NAME_COLLISION", "A party with this name already exists.");

  if (new Set(gstins).size !== gstins.length)
    throw conflict("PARTY_GSTIN_TAKEN", "A party with this GSTIN already exists.");

  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId} || ':parties'))`);

  const taken = (column: typeof parties.normalizedName | typeof parties.gstin, keys: string[]) =>
    tx
      .select({ id: parties.id })
      .from(parties)
      .where(
        and(
          eq(parties.orgId, orgId),
          inArray(column, keys),
          exceptId ? ne(parties.id, exceptId) : undefined,
        ),
      )
      .limit(1);

  if (!allowNamesake && (await taken(parties.normalizedName, names)).length > 0)
    throw conflict("PARTY_NAME_COLLISION", "A party with this name already exists.");

  if (gstins.length > 0 && (await taken(parties.gstin, gstins)).length > 0)
    throw conflict("PARTY_GSTIN_TAKEN", "A party with this GSTIN already exists.");
}

// Callers assign ids, so an import can reference a master before it is written.
export async function createParties(
  tx: DbTransaction,
  orgId: string,
  fields: readonly (PartyFields & { id: string })[],
  allowNamesake: boolean,
): Promise<(typeof parties.$inferSelect)[]> {
  if (fields.length === 0) return [];

  const values = fields.map((row) => ({ ...partyValues(row), id: row.id, orgId }));
  await claimParties(tx, orgId, values, allowNamesake);

  const created: (typeof parties.$inferSelect)[] = [];

  for (const chunk of insertChunks(values))
    created.push(...(await tx.insert(parties).values(chunk).returning()));

  return created;
}

// Templates own code 3000 and 6800–6999.
const ACCOUNT_CODE_RANGES: Record<AccountType, readonly [number, number]> = {
  asset: [1200, 1999],
  liability: [2000, 2999],
  equity: [3001, 3999],
  income: [5000, 5999],
  expense: [6000, 6799],
};

export function accountNameTaken(error: unknown): never {
  if (uniqueViolationConstraint(error) === "accounts_org_active_name_idx") {
    throw conflict("ACCOUNT_NAME_TAKEN", "An account with this name already exists.");
  }

  throw error;
}

export const accountCreateFields = {
  name: shortName.max(120),
  supplyClass: z.enum(SUPPLY_CLASSES).optional(),
  parent: z.union([z.object({ type: z.enum(ACCOUNT_TYPES) }), z.object({ accountId: z.uuid() })]),
};

export type AccountCreateInput = z.output<z.ZodObject<typeof accountCreateFields>> & {
  id: string;
};

export function accountSupplyError(
  type: AccountType,
  supplyClass: (typeof SUPPLY_CLASSES)[number] | undefined,
) {
  if (type === "income" && supplyClass === undefined)
    return {
      code: "SUPPLY_CLASS_REQUIRED",
      message: "Income accounts require a GST supply class.",
    };

  if (type !== "income" && supplyClass !== undefined)
    return {
      code: "SUPPLY_CLASS_NOT_ALLOWED",
      message: "Only income accounts may have a GST supply class.",
    };

  return null;
}

export function accountCodeAllocator(existing: readonly { type: AccountType; code: string }[]) {
  // Codes are unique per organization, across types.
  const used = new Set(existing.map((row) => row.code));

  return (
    type: AccountType,
    parent?: Pick<typeof accounts.$inferSelect, "code" | "systemKey">,
  ): string | null => {
    const [start, end] =
      parent && MONEY_KINDS.some((kind) => kind === parent.systemKey)
        ? [Number(parent.code) + 1, Number(parent.code) + 99]
        : ACCOUNT_CODE_RANGES[type];

    // A group fills its own range from the first available slot; seeded/system
    // accounts elsewhere in the type must not push a child out of that range.
    const first = parent
      ? start
      : existing.reduce((last, row) => {
          const code = Number(row.code);

          return row.type === type && code >= start && code <= end ? Math.max(last, code) : last;
        }, start - 1) + 1;

    for (let code = first; code <= end; code++) {
      const text = String(code);

      if (used.has(text)) continue;
      used.add(text);

      return text;
    }

    return null;
  };
}

export async function createAccounts(
  tx: DbTransaction,
  orgId: string,
  inputs: readonly AccountCreateInput[],
): Promise<(typeof accounts.$inferSelect)[]> {
  if (inputs.length === 0) return [];

  const parentIds = [
    ...new Set(
      inputs.flatMap((input) => ("accountId" in input.parent ? [input.parent.accountId] : [])),
    ),
  ];

  const parents =
    parentIds.length === 0
      ? []
      : await tx
          .select({
            id: accounts.id,
            code: accounts.code,
            type: accounts.type,
            systemKey: accounts.systemKey,
            active: accounts.active,
            isLeaf: sql<boolean>`${isLeaf(orgId)}`,
          })
          .from(accounts)
          .where(and(eq(accounts.orgId, orgId), inArray(accounts.id, parentIds)))
          .orderBy(asc(accounts.id))
          .for("share");

  const parentById = new Map(parents.map((row) => [row.id, row]));

  const resolved = inputs.map((input) => {
    if ("type" in input.parent) return { input, parent: undefined, type: input.parent.type };

    const parent = parentById.get(input.parent.accountId);

    if (!parent) throw new ORPCError("NOT_FOUND", { message: "Account not found." });

    if (!parent.active || parent.isLeaf)
      throw badRequest("ACCOUNT_PARENT_INVALID", "Choose an active account group.");

    return { input, parent, type: parent.type };
  });

  // The allocator reads only codes of the types being created.
  const existing = await tx
    .select({ type: accounts.type, code: accounts.code })
    .from(accounts)
    .where(
      and(
        eq(accounts.orgId, orgId),
        inArray(accounts.type, [...new Set(resolved.map((row) => row.type))]),
      ),
    );

  const allocateCode = accountCodeAllocator(existing);

  const values = resolved.map(({ input, parent, type }) => {
    const error = accountSupplyError(type, input.supplyClass);

    if (error) throw badRequest(error.code, error.message);
    const code = allocateCode(type, parent);

    if (code === null)
      throw badRequest(
        "ACCOUNT_CODES_FULL",
        "This account type or group has no free account codes.",
      );

    return {
      id: input.id,
      orgId,
      name: input.name,
      parentId: parent?.id ?? null,
      code,
      type,
      supplyClass: input.supplyClass ?? null,
    };
  });

  try {
    const created: (typeof accounts.$inferSelect)[] = [];

    for (const chunk of insertChunks(values))
      created.push(...(await tx.insert(accounts).values(chunk).returning()));

    return created;
  } catch (error) {
    if (uniqueViolationConstraint(error) === "accounts_org_code_idx")
      throw new ORPCError("CONFLICT", {
        message: "Another account took that code at the same moment. Try again.",
      });
    accountNameTaken(error);
  }
}

const optionalUnit = z.string().trim().min(1).max(20).optional();

export const itemFields = {
  name: masterName,
  hsnSac: optionalHsnSac,
  unit: optionalUnit,
  unitPrice: money,
  mrp: positiveMoney.optional(),
  incomeAccountId: z.uuid(),
  taxCode: optionalTaxCode,
};

export type ItemFields = z.output<z.ZodObject<typeof itemFields>>;

export function itemEligibilityError(
  account: { supplyClass: string | null } | undefined,
  hsnSac: string | undefined,
  taxCode: string | undefined,
  hasRate: boolean,
) {
  if (!account)
    return {
      code: "INCOME_ACCOUNT_INVALID",
      message: "Choose an active income account that is not a group or system account.",
    };

  if (account.supplyClass === "taxable" && !hsnSac)
    return { code: "HSN_SAC_REQUIRED", message: "Enter an HSN/SAC code for a taxable item." };

  if (account.supplyClass === "taxable" && !taxCode)
    return { code: "TAX_CODE_REQUIRED", message: "Choose a GST rate for a taxable item." };

  if (account.supplyClass !== "taxable" && taxCode)
    return { code: "TAX_CODE_NOT_ALLOWED", message: "Only taxable items may have a GST rate." };

  if (taxCode && !hasRate)
    return {
      code: "TAX_CODE_INVALID",
      message: "Choose a GST rate effective in this organization.",
    };

  return null;
}

export async function itemValues(
  tx: DbTransaction,
  orgId: string,
  fields: readonly ItemFields[],
  today: string,
) {
  if (fields.length === 0) return [];

  const accountIds = [...new Set(fields.map((row) => row.incomeAccountId))];
  const codes = [...new Set(fields.flatMap((row) => (row.taxCode ? [row.taxCode] : [])))];
  const incomeAccounts = await postableAccounts(tx, orgId, accountIds, ["income"]);
  const accountsById = new Map(incomeAccounts.map((row) => [row.id, row]));
  const rates = await ratesByCode(tx, orgId, codes, today);

  return fields.map((row) => {
    const account = accountsById.get(row.incomeAccountId);

    const error = itemEligibilityError(
      account,
      row.hsnSac,
      row.taxCode,
      row.taxCode !== undefined && rates.has(row.taxCode),
    );

    if (error) throw badRequest(error.code, error.message);

    return {
      name: row.name,
      normalizedName: normalizedName(row.name),
      hsnSac: row.hsnSac ?? null,
      unit: row.unit ?? null,
      unitPricePaise: row.unitPrice,
      mrpPaise: row.mrp ?? null,
      incomeAccountId: row.incomeAccountId,
      taxCode: row.taxCode ?? null,
    };
  });
}

export async function createItems(
  tx: DbTransaction,
  orgId: string,
  fields: readonly (ItemFields & { id: string })[],
  today: string,
): Promise<(typeof items.$inferSelect)[]> {
  const values = await itemValues(tx, orgId, fields, today);
  const created: (typeof items.$inferSelect)[] = [];

  try {
    for (const chunk of insertChunks(
      values.map((row, index) => ({ ...row, id: fields[index]!.id, orgId })),
    ))
      created.push(...(await tx.insert(items).values(chunk).returning()));
  } catch (error) {
    itemNameTaken(error);
  }

  return created;
}

export function itemNameTaken(error: unknown): never {
  if (uniqueViolationConstraint(error) === "items_org_normalized_name_idx") {
    throw conflict("ITEM_NAME_TAKEN", "An item with that name already exists.");
  }

  throw error;
}
