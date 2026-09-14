// Money sits in leaf accounts under these system-keyed groups. A Payment Method
// names one leaf; each group only totals its leaves.
export const MONEY_KINDS = ["cash", "bank"] as const;

export type MoneyKind = (typeof MONEY_KINDS)[number];
