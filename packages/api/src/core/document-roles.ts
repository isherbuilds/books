// Dependency-free, so the web reads the same roles: hasRole() in lib/settlements.ts
// turns this table into SQL.
import type { DocumentType } from "@accly/db/schema/documents";

export type Side = "receivable" | "payable";

/** What a stored document is to settlement, derived from its type and exposure side. */
type Role = {
  /** It settles claims on this side: an allocation source. */
  source?: Side;
  /** It is a claim on this side that sources settle: an allocation target. */
  target?: Side;
  /** It pays out credits, so it is the target of the credits it names. */
  refund?: true;
  /** Its money waits in an advance account, so applying it after posting moves it. */
  advance?: true;
};

// The one place a document's exposure side is read. "none" is a document without a
// side: a Journal (its parties sit on lines) or a direct Receipt or Payment. A pair not
// listed takes no part in settlement.
const ROLES: { [Type in DocumentType]?: { [Key in Side | "none"]?: Role } } = {
  invoice: { receivable: { target: "receivable" } },
  bill: { payable: { target: "payable" } },
  creditNote: { receivable: { source: "receivable" } },
  debitNote: { payable: { source: "payable" } },
  // A Journal settles on the receivable side only: a source for a party it credits and a
  // target for one it debits (`settlementPaise`).
  journal: { none: { source: "receivable", target: "receivable" } },
  receipt: {
    receivable: { source: "receivable", advance: true },
    payable: { target: "payable", refund: true },
  },
  payment: {
    payable: { source: "payable", advance: true },
    receivable: { target: "receivable", refund: true },
  },
  openingClaim: { receivable: { target: "receivable" }, payable: { target: "payable" } },
  openingCredit: { receivable: { source: "receivable" }, payable: { source: "payable" } },
};

export function documentRole(document: { type: DocumentType; exposureSide: Side | null }): Role {
  return ROLES[document.type]?.[document.exposureSide ?? "none"] ?? {};
}
