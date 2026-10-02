// Dependency-free on purpose: the client bundle reads this list. See `settlement-kinds.ts`.
export const LOCK_KINDS = ["general", "tax"] as const;

export type LockKind = (typeof LOCK_KINDS)[number];
