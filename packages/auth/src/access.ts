import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

// Dependency-free (no db, no env) so server and client can both import it.
//
// The accounting core (docs/specs/accounting-core.md, call 10) owns the document,
// party, account, allocation, lock and export statements. The customer, opd,
// billing, payer and staff statements and the reception/cashier/admin roles are
// the legacy outpatient domain; they leave with slice 7.
const DOCUMENT_ACTIONS = ["read", "create", "post", "cancel"] as const;

export const ac = createAccessControl({
  ...defaultStatements,
  // `member` is Better Auth's own statement; "read" is ours, so everyone in an org
  // can see who else is in it while only admins can change it.
  member: ["create", "read", "update", "delete"],
  receipt: DOCUMENT_ACTIONS,
  payment: DOCUMENT_ACTIONS,
  invoice: DOCUMENT_ACTIONS,
  bill: DOCUMENT_ACTIONS,
  note: DOCUMENT_ACTIONS,
  journal: DOCUMENT_ACTIONS,
  openingBalance: DOCUMENT_ACTIONS,
  allocation: ["apply", "reverse"],
  party: ["create", "read", "update"],
  account: ["create", "read", "update"],
  paymentMethod: ["create", "read", "update"],
  lock: ["read", "set", "grantException"],
  export: ["read"],
  customer: ["create", "read", "update"],
  opd: ["create", "read", "update"],
  billing: ["read", "write", "creditNote"],
  item: ["create", "read", "update"],
  payer: ["create", "read", "update"],
  staff: ["create", "read", "update"],
  settings: ["read", "update"],
  audit: ["read"],
  report: ["read", "readDailyCollections", "readOpdRegister", "readFinancial"],
  file: ["upload", "read", "delete"],
} as const);

export const reception = ac.newRole({
  ...memberAc.statements,
  member: ["read"],
  customer: ["create", "read", "update"],
  opd: ["create", "read", "update"],
  billing: ["read", "write"],
  item: ["read"],
  payer: ["read"],
  staff: ["read"],
  settings: ["read"],
  file: ["upload", "read"],
});

// Cashiers close their shift from Daily Collections; customer-level and accounting
// reports stay separate.
export const cashier = ac.newRole({
  ...memberAc.statements,
  member: ["read"],
  customer: ["read"],
  opd: ["read"],
  billing: ["read", "write"],
  item: ["read"],
  payer: ["read"],
  staff: ["read"],
  settings: ["read"],
  report: ["readDailyCollections"],
  file: ["read"],
});

// Creates and posts Receipt, Payment and Invoice at a desk; never cancels,
// allocates or creates masters.
export const operator = ac.newRole({
  ...memberAc.statements,
  member: ["read"],
  receipt: ["read", "create", "post"],
  payment: ["read", "create", "post"],
  invoice: ["read", "create", "post"],
  party: ["read"],
  account: ["read"],
  item: ["read"],
  paymentMethod: ["read"],
  export: ["read"],
  settings: ["read"],
  file: ["read"],
});

export const accountant = ac.newRole({
  ...memberAc.statements,
  member: ["read"],
  receipt: ["read", "create", "post", "cancel"],
  payment: ["read", "create", "post", "cancel"],
  invoice: ["read", "create", "post", "cancel"],
  bill: ["read", "create", "post", "cancel"],
  note: ["read", "create", "post", "cancel"],
  journal: ["read", "create", "post", "cancel"],
  openingBalance: ["read", "create", "post", "cancel"],
  allocation: ["apply", "reverse"],
  party: ["create", "read", "update"],
  account: ["create", "read", "update"],
  item: ["create", "read", "update"],
  paymentMethod: ["create", "read", "update"],
  lock: ["read"],
  export: ["read"],
  customer: ["read"],
  opd: ["read"],
  billing: ["read", "creditNote"],
  payer: ["read"],
  staff: ["read"],
  settings: ["read"],
  report: ["read", "readDailyCollections", "readOpdRegister", "readFinancial"],
  audit: ["read"],
  file: ["read"],
});

// The chartered accountant reads everything, locks periods and grants exceptions,
// and never posts.
export const ca = ac.newRole({
  ...memberAc.statements,
  member: ["read"],
  receipt: ["read"],
  payment: ["read"],
  invoice: ["read"],
  bill: ["read"],
  note: ["read"],
  journal: ["read"],
  openingBalance: ["read"],
  party: ["read"],
  account: ["read"],
  item: ["read"],
  paymentMethod: ["read"],
  lock: ["read", "set", "grantException"],
  export: ["read"],
  settings: ["read"],
  report: ["read", "readFinancial"],
  audit: ["read"],
  file: ["read"],
});

// `admin` and `owner` read as duplicates and must stay that way: they spread
// different Better Auth bases (`ownerAc` alone grants `organization:delete`), so
// sharing one body would silently move org deletion between them.
export const admin = ac.newRole({
  ...adminAc.statements,
  member: ["create", "read", "update", "delete"],
  receipt: ["read", "create", "post", "cancel"],
  payment: ["read", "create", "post", "cancel"],
  invoice: ["read", "create", "post", "cancel"],
  bill: ["read", "create", "post", "cancel"],
  note: ["read", "create", "post", "cancel"],
  journal: ["read", "create", "post", "cancel"],
  openingBalance: ["read", "create", "post", "cancel"],
  allocation: ["apply", "reverse"],
  party: ["create", "read", "update"],
  account: ["create", "read", "update"],
  item: ["create", "read", "update"],
  paymentMethod: ["create", "read", "update"],
  lock: ["read", "set", "grantException"],
  export: ["read"],
  customer: ["create", "read", "update"],
  opd: ["create", "read", "update"],
  billing: ["read", "write", "creditNote"],
  payer: ["create", "read", "update"],
  staff: ["create", "read", "update"],
  settings: ["read", "update"],
  audit: ["read"],
  report: ["read", "readDailyCollections", "readOpdRegister", "readFinancial"],
  file: ["upload", "read", "delete"],
});

export const owner = ac.newRole({
  ...ownerAc.statements,
  member: ["create", "read", "update", "delete"],
  receipt: ["read", "create", "post", "cancel"],
  payment: ["read", "create", "post", "cancel"],
  invoice: ["read", "create", "post", "cancel"],
  bill: ["read", "create", "post", "cancel"],
  note: ["read", "create", "post", "cancel"],
  journal: ["read", "create", "post", "cancel"],
  openingBalance: ["read", "create", "post", "cancel"],
  allocation: ["apply", "reverse"],
  party: ["create", "read", "update"],
  account: ["create", "read", "update"],
  item: ["create", "read", "update"],
  paymentMethod: ["create", "read", "update"],
  lock: ["read", "set", "grantException"],
  export: ["read"],
  customer: ["create", "read", "update"],
  opd: ["create", "read", "update"],
  billing: ["read", "write", "creditNote"],
  payer: ["create", "read", "update"],
  staff: ["create", "read", "update"],
  settings: ["read", "update"],
  audit: ["read"],
  report: ["read", "readDailyCollections", "readOpdRegister", "readFinancial"],
  file: ["upload", "read", "delete"],
});

// Better Auth merges built-in `member`/`admin`/`owner` roles into this map, but Accly Books
// authorizes only through `parseRoles`/`authorize`, which reject stored `member`;
// reset legacy rows before deploying.
export const roles = { owner, admin, accountant, ca, operator, reception, cashier } as const;

export type RoleKey = keyof typeof roles;

export const ROLE_LABELS: Record<RoleKey, string> = {
  owner: "Owner",
  admin: "Administrator",
  accountant: "Accountant",
  ca: "Chartered Accountant",
  operator: "Operator",
  reception: "Reception",
  cashier: "Cashier",
};

export const ORG_ROLES = [
  "owner",
  "admin",
  "accountant",
  "ca",
  "operator",
  "reception",
  "cashier",
] as const satisfies readonly RoleKey[];

export type AppPermission = Parameters<typeof roles.admin.authorize>[0];

// Better Auth stores roles comma-joined and authorizes them as a union, so mirror
// that rather than reading the first entry, and reject an undefined role instead of
// silently downgrading it.
export function parseRoles(stored: string): RoleKey[] {
  const parsed = stored
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);

  const unknown = parsed.filter((role) => !Object.hasOwn(roles, role));

  if (unknown.length > 0) {
    throw new Error(`Unknown organization role(s): ${unknown.join(", ")}`);
  }

  // SAFETY: The check above rejects every key absent from the application role registry.
  return parsed as RoleKey[];
}

export function authorize(memberRoles: readonly RoleKey[], permission: AppPermission): boolean {
  return memberRoles.some((role) => roles[role].authorize(permission).success);
}
