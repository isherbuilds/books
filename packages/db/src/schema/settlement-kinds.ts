// Dependency-free on purpose: `@accly/api/lib/schemas` wraps this in a zod enum and
// is bundled into the client, so it must not pull drizzle in.
export const SETTLEMENT_KINDS = ["against", "advance", "direct"] as const;
