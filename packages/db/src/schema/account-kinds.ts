// Dependency-free on purpose: the client bundle reads these lists, and the schema
// files import drizzle. See `settlement-kinds.ts`.
export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const SUPPLY_CLASSES = ["taxable", "exempt", "nil", "nonGst", "notASupply"] as const;

export type SupplyClass = (typeof SUPPLY_CLASSES)[number];
