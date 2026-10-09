// Dependency-free, so the server's statements and exports and the web's lists share one label.
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

/** A payable opening claim is the vendor's bill; every other document reads by its type. */
export function documentLabel(type: DocumentType, side: "receivable" | "payable" | null) {
  if (type === "openingClaim") return side === "payable" ? "Opening bill" : "Opening invoice";

  return DOCUMENT_TYPE_LABELS[type];
}
