// Dependency-free on purpose: `@accly/api/lib/schemas` wraps this in a zod enum and
// is bundled into the client, so it must not pull drizzle in.
export const PAYER_TYPES = ["insurer", "tpa", "corporate", "scheme"] as const;

export type PayerType = (typeof PAYER_TYPES)[number];
