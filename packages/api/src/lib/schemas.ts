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

export const indianStateCode = z
  .string()
  .refine((code) => Object.hasOwn(INDIAN_STATES, code), "Use a valid Indian state code");

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
  .refine((name) => normalizedName(name).length > 0, "Name must include a letter or number");

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
  narration: settlementPostFields.narration,
  lines: z
    .array(
      z.discriminatedUnion("kind", [
        z.object({
          kind: z.literal("item"),
          itemId: z.uuid(),
          quantity: z.number().int().min(1).max(1_000_000),
          unitPrice: money.optional(),
          description: z.string().trim().max(200).optional(),
        }),
        z.object({
          kind: z.literal("account"),
          accountId: z.uuid(),
          description: z.string().trim().min(1).max(200),
          amount: positiveMoney,
        }),
      ]),
    )
    .min(1)
    .max(100),
};

/** The keyset, party, period and search fields every document register takes. */
export const documentListFields = {
  q: searchQuery,
  partyId: z.uuid().optional(),
  ...period,
  cursor: z.uuid().optional(),
  limit: pageLimit,
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

export const pan = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Use a valid 10-character PAN");

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

export function validateGstinIdentity(
  value: { gstin?: string; pan?: string; stateCode: string },
  context: z.RefinementCtx,
): void {
  if (!value.gstin) return;

  if (value.gstin.slice(0, 2) !== value.stateCode) {
    context.addIssue({
      code: "custom",
      path: ["gstin"],
      message: "GSTIN state code must match the registered state",
    });
  }

  if (value.pan && value.gstin.slice(2, 12) !== value.pan) {
    context.addIssue({
      code: "custom",
      path: ["gstin"],
      message: "GSTIN must contain the same PAN",
    });
  }
}
