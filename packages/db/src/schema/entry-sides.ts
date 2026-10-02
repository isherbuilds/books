// Dependency-free on purpose: `@accly/api/lib/schemas` wraps this in a zod enum for the
// client bundle. See `settlement-kinds.ts`.
export const ENTRY_SIDES = ["debit", "credit"] as const;

export type EntrySide = (typeof ENTRY_SIDES)[number];
