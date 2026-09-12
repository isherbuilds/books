import { PAYER_TYPES, type PayerType } from "@accly/db/schema/payer-types";
import { PAYMENT_METHODS, type PaymentMethod } from "@accly/db/schema/payment-methods";
import { z } from "zod";

import { NON_NEGATIVE_MONEY_PATTERN, parseMoney } from "../core/money";
import { INDIAN_STATES } from "./indian-states";

// Input fragments shared by more than one router.

/** Decimal string in, integer paise out: handlers never see a money string. */
export const money = z.string().regex(NON_NEGATIVE_MONEY_PATTERN).transform(parseMoney);

export const positiveMoney = money.refine((value) => value > 0n);

// Calendar-valid, not shape-valid: `2026-02-31` must fail here, not in Postgres.
export const dateOnly = z.iso.date();

// Case is kept: names appear on legal documents. Matching is case-insensitive at the database.
export const shortName = z
  .string()
  .trim()
  .overwrite((value) => value.replace(/\s+/g, " "))
  .min(1)
  .max(200);

export const phone = z.string().trim().min(4).max(20);

export const reason = z.string().trim().min(1).max(500);

export const note = z.string().trim().max(500).optional();

export const searchQuery = z.string().trim().min(1).max(100).optional();

// Escapes LIKE wildcards so a typed `%` matches a literal percent sign.
export function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

export const pageLimit = z.number().int().min(1).max(100).default(50);

export const paymentMethod = z.enum(PAYMENT_METHODS);

export const payerType = z.enum(PAYER_TYPES);

export type { PaymentMethod, PayerType };

/** Everything but cash lands somewhere traceable, so the desk records the trace. */
export function requirePaymentReference(
  value: { method: PaymentMethod; reference?: string },
  context: z.RefinementCtx,
): void {
  if (value.method !== "cash" && !value.reference) {
    context.addIssue({
      code: "custom",
      path: ["reference"],
      message: "Add the transaction reference for a non-cash payment",
    });
  }
}

export const paymentLine = z
  .object({
    method: paymentMethod,
    amount: positiveMoney,
    reference: z.string().trim().min(1).max(100).optional(),
  })
  .superRefine(requirePaymentReference);

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

export const optionalGstin = z
  .string()
  .trim()
  .toUpperCase()
  .refine(
    (value) => value === "" || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value),
    "Use a valid GSTIN",
  )
  .transform((value) => value || undefined)
  .optional();

export const indianStateCode = z
  .string()
  .refine((code) => Object.hasOwn(INDIAN_STATES, code), "Use a valid Indian state code");

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
