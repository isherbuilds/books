import { ENTRY_SIDES, type EntrySide } from "@accly/db/schema/document-lines";
import { SETTLEMENT_KINDS } from "@accly/db/schema/settlement-kinds";
import { z } from "zod";

import { NON_NEGATIVE_MONEY_PATTERN, parseMoney } from "../core/money";
import { INDIAN_STATES } from "./indian-states";
import { normalizedName } from "./normalized-name";

// Input fragments shared by more than one router.

/** Decimal string in, integer paise out: handlers never see a money string. */
export const money = z.string().regex(NON_NEGATIVE_MONEY_PATTERN).transform(parseMoney);

export const positiveMoney = money.refine((value) => value > 0n);

// Calendar-valid, not shape-valid: `2026-02-31` must fail here, not in Postgres.
export const dateOnly = z.iso.date();

export const entryLineFields = {
  accountId: z.uuid(),
  side: z.enum(ENTRY_SIDES),
  amount: positiveMoney,
  description: z
    .string()
    .trim()
    .max(200)
    .transform((value) => value || undefined)
    .optional(),
};

export function balancedEntryLines(
  input: { lines: readonly { side: EntrySide; amount: bigint }[] },
  context: z.RefinementCtx,
): void {
  let debitTotal = 0n;
  let creditTotal = 0n;

  for (const line of input.lines) {
    if (line.side === "debit") debitTotal += line.amount;
    else creditTotal += line.amount;
  }

  if (debitTotal === 0n || creditTotal === 0n || debitTotal !== creditTotal) {
    context.addIssue({
      code: "custom",
      path: ["lines"],
      message: "Debits must equal credits.",
    });
  }
}

export const indianStateCode = z
  .string()
  .refine((code) => Object.hasOwn(INDIAN_STATES, code), "Use a valid Indian state code");

// Blank means absent: `deriveFromGstin` requires it only when there is no GSTIN.
export const optionalStateCode = z
  .string()
  .refine(
    (code) => code === "" || Object.hasOwn(INDIAN_STATES, code),
    "Use a valid Indian state code",
  )
  .transform((code) => code || undefined)
  .optional();

/** An optional date range; pair with `.superRefine(orderedPeriod)`. */
export const period = { from: dateOnly.optional(), to: dateOnly.optional() };

export function orderedPeriod(
  value: { from?: string; to?: string },
  context: z.RefinementCtx,
): void {
  if (value.from && value.to && value.from > value.to) {
    context.addIssue({
      code: "custom",
      path: ["to"],
      message: "End date must not be before the start date",
    });
  }
}

// Case is kept: names appear on legal documents. Matching is case-insensitive at the database.
export const shortName = z
  .string()
  .trim()
  .overwrite((value) => value.replace(/\s+/g, " "))
  .min(1)
  .max(200);

/** A master record's name, unique per Organization after `normalizedName`. */
export const masterName = shortName
  .max(120)
  .refine(
    (name) => /[\p{L}\p{N}]/u.test(normalizedName(name)),
    "Name must include a letter or number",
  );

// GST Rules 46 and 50 cap a number at 16 characters of letters, digits, '-' and '/':
// up to 4 here, then "26-27/" and a sequence of up to 6 digits. Stored in upper case:
// GSTR-1 and the IRP compare numbers without case, so "rct" must not start a second
// series beside "RCT".
export const documentPrefix = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9/-]{1,4}$/, "Use 1 to 4 letters, digits, '-' or '/'");

export const reason = z.string().trim().min(1).max(500);

// One page of a keyset list. 25 rows keep a list page fast to render and to navigate;
// clients omit `limit` and take this default, and Load more fetches the next page.
export const pageLimit = z.number().int().min(1).max(100).default(25);

export const searchQuery = z.string().trim().min(1).max(100).optional();

export const settlementPostFields = {
  documentDate: dateOnly.optional(),
  amount: positiveMoney,
  paymentMethodId: z.uuid(),
  reference: z
    .string()
    .trim()
    .max(120)
    .transform((value) => value || undefined)
    .optional(),
  narration: z
    .string()
    .trim()
    .max(500)
    .transform((value) => value || undefined)
    .optional(),
};

export const invoiceFields = {
  partyId: z.uuid(),
  documentDate: dateOnly.optional(),
  dueDate: dateOnly.optional(),
  placeOfSupplyStateCode: indianStateCode,
  reference: settlementPostFields.reference,
  discount: money.optional(),
  narration: settlementPostFields.narration,
  // Invoice lines are Items only (accounting-core call 5). `kind` stays on the wire,
  // matching the stored line kind that Bills also use.
  lines: z
    .array(
      z.object({
        kind: z.literal("item"),
        itemId: z.uuid(),
        quantity: z.number().int().min(1).max(1_000_000),
        unitPrice: money.optional(),
        description: z.string().trim().max(200).optional(),
      }),
    )
    .min(1)
    .max(100),
};

export const optionalTaxCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{1,12}$/)
  .optional();

export const optionalHsnSac = z
  .string()
  .trim()
  .regex(/^\d{4,8}$/, "Use a 4 to 8 digit HSN/SAC code")
  .optional();

// The draft's id and the version its editor loaded; without one a save writes a new
// document.
export const draftToken = z.object({ id: z.uuid(), version: z.number().int().min(1) });

/** The keyset, period and search fields every document register takes. */
export const documentPageFields = {
  q: searchQuery,
  ...period,
  cursor: z.uuid().optional(),
  limit: pageLimit,
};

/** `documentPageFields` plus the header party filter, for registers whose document names a party. */
export const documentListFields = {
  ...documentPageFields,
  partyId: z.uuid().optional(),
};

export const settlementListFields = {
  ...documentListFields,
  paymentMethodIds: z.array(z.uuid()).min(1).max(20).optional(),
  state: z.enum(["posted", "cancelled"]).optional(),
  settlementKind: z.enum(SETTLEMENT_KINDS).optional(),
};

// Escapes LIKE wildcards so a typed `%` matches a literal percent sign.
export function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

// Time zones are validated by probing the formatter because engines disagree
// on canonical ids such as Asia/Kolkata and Asia/Calcutta.
function isSupportedTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });

    return true;
  } catch {
    return false;
  }
}

export const timeZone = z.string().refine(isSupportedTimeZone, {
  message: "Use a valid IANA time zone like Asia/Kolkata",
});

export const optionalPan = z
  .string()
  .trim()
  .toUpperCase()
  .refine((value) => value === "" || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(value), "Use a valid PAN")
  .transform((value) => value || undefined)
  .optional();

export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const optionalGstin = z
  .string()
  .trim()
  .toUpperCase()
  .refine((value) => value === "" || GSTIN_PATTERN.test(value), "Use a valid GSTIN")
  .transform((value) => value || undefined)
  .optional();

export const indianPinCode = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{5}$/, "Use a valid 6-digit PIN code");

/** The state code and PAN a valid GSTIN carries, or null. */
export function gstinParts(value: string): { stateCode: string; pan: string } | null {
  const gstin = value.trim().toUpperCase();
  const stateCode = gstin.slice(0, 2);

  if (!GSTIN_PATTERN.test(gstin) || !Object.hasOwn(INDIAN_STATES, stateCode)) return null;

  return { stateCode, pan: gstin.slice(2, 12) };
}

type TaxIdentity = { gstin?: string; pan?: string; stateCode?: string };

/**
 * A GSTIN carries its state code (characters 1-2) and PAN (3-12), so with one both are
 * derived here; a state or PAN sent beside it must match. Without one, the state is
 * required. Use as `.transform(deriveFromGstin)`.
 */
export function deriveFromGstin<T extends TaxIdentity>(
  value: T,
  context: z.RefinementCtx,
): T & { stateCode: string } {
  if (value.gstin) {
    const parts = gstinParts(value.gstin);

    if (!parts) {
      context.addIssue({
        code: "custom",
        path: ["gstin"],
        message: "GSTIN must start with a valid Indian state code",
      });
    } else if (value.stateCode && value.stateCode !== parts.stateCode) {
      context.addIssue({
        code: "custom",
        path: ["gstin"],
        message: "GSTIN state code must match the registered state",
      });
    } else if (value.pan && value.pan !== parts.pan) {
      context.addIssue({
        code: "custom",
        path: ["gstin"],
        message: "GSTIN must contain the same PAN",
      });
    }

    return { ...value, stateCode: parts?.stateCode ?? "", pan: parts?.pan };
  }

  if (!value.stateCode) {
    context.addIssue({ code: "custom", path: ["stateCode"], message: "Choose a state" });
  }

  return { ...value, stateCode: value.stateCode ?? "" };
}

/** `deriveFromGstin` for an Organization, whose PAN is required. */
export function deriveOrganizationIdentity<T extends TaxIdentity>(
  value: T,
  context: z.RefinementCtx,
): T & { stateCode: string; pan: string } {
  const derived = deriveFromGstin(value, context);

  if (!derived.pan) {
    context.addIssue({ code: "custom", path: ["pan"], message: "Enter the PAN" });
  }

  return { ...derived, pan: derived.pan ?? "" };
}
