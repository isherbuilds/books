import { ORPCError } from "@orpc/server";
import { sql, type AnyColumn } from "drizzle-orm";

/**
 * Why a CONFLICT happened when a client can take a specific recovery path.
 * Every other CONFLICT is a plain `ORPCError("CONFLICT")`: the client refetches
 * and shows the server message.
 */
export type ConflictReason =
  | "DUPLICATE"
  | "STALE_RECORD"
  | "PARTY_NAME_COLLISION"
  | "PARTY_GSTIN_TAKEN"
  | "ITEM_NAME_TAKEN"
  | "ACCOUNT_NAME_TAKEN";

/** A clash the operator can act on. Expected, so the server does not log it. */
export function conflict(reason: ConflictReason, message: string) {
  return new ORPCError("CONFLICT", { message, data: { reason } });
}

/**
 * The next value of a `timestamptz(3)` edit token. It moves forward even when two saves
 * land in one millisecond, so an editor's stale token can never match again.
 */
export function nextEditToken(updatedAt: AnyColumn) {
  return sql`greatest(statement_timestamp(), ${updatedAt} + interval '1 millisecond')::timestamptz(3)`;
}

/**
 * Why the server refused an input. A client maps a reason to the field it names
 * (`applyOrpcFieldError`) and otherwise shows the message.
 */
export type RefusalReason =
  | "ACCOUNT_CODES_FULL"
  | "ACCOUNT_INVALID"
  | "ACCOUNT_IN_USE"
  | "ACCOUNT_NOT_MONEY"
  | "ACCOUNT_PARENT_INVALID"
  | "ACCOUNT_SYSTEM"
  | "ADJUSTMENT_ACCOUNT_INVALID"
  | "ADJUSTMENT_UNALLOCATED"
  | "ADVANCE_SUPPLY_REQUIRED"
  | "ADVANCE_TAX_UNSUPPORTED"
  | "ALLOCATION_EXCEEDS_OUTSTANDING"
  | "ALLOCATION_EXCEEDS_SOURCE"
  | "ALLOCATION_SOURCE_INVALID"
  | "ALLOCATION_TARGET_INVALID"
  | "BEFORE_OPENING_BALANCE"
  | "BILL_NUMBER_TAKEN"
  | "BILL_TDS_EXCEEDS_TOTAL"
  | "BILL_ZERO_TOTAL"
  | "DISCOUNT_CONFLICT"
  | "DISCOUNT_EXCEEDS_SUBTOTAL"
  | "DUE_DATE_BEFORE_DOCUMENT"
  | "EXCEPTION_ACTIVE"
  | "EXPENSE_ACCOUNT_INVALID"
  | "FILE_TOO_LARGE"
  | "FINANCIAL_YEAR_FIXED"
  | "HSN_SAC_REQUIRED"
  | "IMPORT_INVALID"
  | "INCOME_ACCOUNT_INVALID"
  | "INVOICE_AMOUNT_TOO_LARGE"
  | "INVOICE_ZERO_TOTAL"
  | "ITEM_INVALID"
  | "ITEM_TAX_CODE_REQUIRED"
  | "LOCKED"
  | "MASTER_LIST_LIMIT"
  | "MEMBER_INVALID"
  | "NOTE_DATE_BEFORE_SOURCE"
  | "NOTE_EXCEEDS_SOURCE"
  | "NOTE_SOURCE_INVALID"
  | "NOTE_TDS_EXCEEDS_TOTAL"
  | "NOTE_ZERO_TOTAL"
  | "NUMBER_SERIES_FULL"
  | "OPENING_BALANCE_AFTER_BUSINESS"
  | "OPENING_BALANCE_DATE_FUTURE"
  | "PARTY_INVALID"
  | "PARTY_REQUIRED"
  | "PARTY_STATE_REQUIRED"
  | "PAYMENT_METHOD_INVALID"
  | "REFUND_AMOUNT_MISMATCH"
  | "REPORT_TOO_LARGE"
  | "SETTLEMENT_EXCEEDS_TOTAL"
  | "SUPPLY_CLASS_NOT_ALLOWED"
  | "SUPPLY_CLASS_REQUIRED"
  | "TAXABLE_ACCOUNT_LINE"
  | "TAXABLE_DIRECT_RECEIPT"
  | "TAX_CODE_INVALID"
  | "TAX_CODE_NOT_ALLOWED"
  | "TAX_CODE_REQUIRED"
  | "TAX_RATE_MISSING"
  | "TDS_PAN_REQUIRED"
  | "TDS_PARTY_REQUIRED"
  | "TDS_SECTION_INVALID"
  | "WORKBOOK_INVALID";

/** An input the operator can correct. The reason names what to correct. */
export function badRequest(reason: RefusalReason, message: string) {
  return new ORPCError("BAD_REQUEST", { message, data: { reason } });
}

/**
 * A state the surrounding transaction should have made impossible — a locked row
 * that vanished, an UPDATE that matched fewer rows than it just selected.
 *
 * This must stay 5xx. `logORPCError` in apps/server drops everything under 500, so
 * dressing a bug as a CONFLICT hides it from the logs and shows staff "Conflict".
 * The message reaches the log, never the browser: apps/server redacts every 5xx
 * message (`redactServerErrors`) and the client shows a generic line.
 */
export function impossible(what: string) {
  return new ORPCError("INTERNAL_SERVER_ERROR", { message: `Invariant violated: ${what}` });
}

/** The element a parallel array must hold at `index`, such as a line's tax share. */
export function nth<T>(items: readonly T[], index: number, what: string): T {
  const item = items[index];

  if (item === undefined) throw impossible(`${what} ${index} is missing`);

  return item;
}
