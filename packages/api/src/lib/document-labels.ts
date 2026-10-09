// Dependency-free, so the server's statements and exports and the web's lists share one
// label: the one owner of document, note, adjustment and audit action labels.
import type { AuditAction } from "@accly/db/audit";
import type { AdjustmentKind } from "@accly/db/schema/document-lines";
import type { DocumentType } from "@accly/db/schema/documents";

export const DOCUMENT_TYPE_LABELS = {
  receipt: "Receipt",
  payment: "Payment",
  invoice: "Invoice",
  bill: "Bill",
  creditNote: "Credit note",
  debitNote: "Debit note",
  journal: "Journal",
  openingBalance: "Opening balance",
  openingClaim: "Opening claim",
  openingCredit: "Opening credit",
} as const satisfies Record<DocumentType, string>;

export const NOTE_TYPE_LABELS = {
  creditNote: DOCUMENT_TYPE_LABELS.creditNote,
  debitNote: DOCUMENT_TYPE_LABELS.debitNote,
} as const;

/**
 * A payable opening claim is the vendor's bill and a payable Receipt is a supplier
 * refund; every other document reads by its type.
 */
export function documentLabel(type: DocumentType, side: "receivable" | "payable" | null) {
  if (type === "openingClaim") return side === "payable" ? "Opening bill" : "Opening invoice";

  if (type === "receipt" && side === "payable") return "Supplier refund";

  return DOCUMENT_TYPE_LABELS[type];
}

/** A Receipt's or Payment's fee, write-off and TDS lines. */
export const ADJUSTMENT_LABELS = {
  fee: "Fee",
  writeOff: "Write-off",
  tds: "TDS deducted by customer",
} as const satisfies Record<AdjustmentKind, string>;

export const AUDIT_ACTION_LABELS = {
  "account.setActive": "Account status changed",
  "allocation.apply": "Amount applied",
  "allocation.reverse": "Applied amount undone",
  "bill.amend": "Bill amended",
  "bill.cancel": "Bill cancelled",
  "bill.post": "Bill posted",
  "creditNote.cancel": "Credit note cancelled",
  "creditNote.post": "Credit note posted",
  "debitNote.cancel": "Debit note cancelled",
  "debitNote.post": "Debit note posted",
  "file.delete": "File deleted",
  "file.read": "File opened",
  "file.upload": "File uploaded",
  "import.commit": "Workbook imported",
  "invoice.amend": "Invoice amended",
  "invoice.cancel": "Invoice cancelled",
  "invoice.post": "Invoice posted",
  "journal.cancel": "Journal cancelled",
  "journal.post": "Journal posted",
  "lock.grantException": "Lock exception granted",
  "lock.revokeException": "Lock exception revoked",
  "lock.set": "Period lock changed",
  "member.invite": "Member invited",
  "member.invite.revoke": "Invitation cancelled",
  "member.join": "Member joined",
  "member.remove": "Member removed",
  "member.role.update": "Member role changed",
  "openingBalance.cancel": "Opening balance cancelled",
  "openingBalance.post": "Opening balance posted",
  "organization.create": "Organization created",
  "payment.cancel": "Payment cancelled",
  "payment.post": "Payment posted",
  "rbac.permission": "Permission check",
  "receipt.cancel": "Receipt cancelled",
  "receipt.post": "Receipt posted",
  "settings.update": "Settings updated",
} as const satisfies Record<AuditAction, string>;
