import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements, memberAc, ownerAc } from "better-auth/plugins/organization/access";

// Dependency-free (no db, no env) so server and client can both import it.
//
// The roles and their grants are the accounting core's (docs/specs/accounting-core.md,
// call 10): owner, accountant, ca and operator.
const DOCUMENT_ACTIONS = ["read", "create", "post", "cancel"] as const;

export const ac = createAccessControl({
  ...defaultStatements,
  // `member` is Better Auth's own statement; "read" is ours, so everyone in an org
  // can see who else is in it while only the owner can change it.
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
  settings: ["read", "update"],
  audit: ["read"],
  report: ["read", "readFinancial"],
  file: ["upload", "read", "delete"],
} as const);

// Creates and posts Receipt, Payment and Invoice at a desk; never cancels,
// allocates, creates masters or exports (spec call 10: exports are accountant and CA work).
export const operator = ac.newRole({
  ...memberAc.statements,
  member: ["read"],
  receipt: ["read", "create", "post"],
  payment: ["read", "create", "post"],
  invoice: ["read", "create", "post"],
  party: ["read"],
  account: ["read"],
  paymentMethod: ["read"],
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
  paymentMethod: ["create", "read", "update"],
  lock: ["read"],
  export: ["read"],
  settings: ["read"],
  report: ["read", "readFinancial"],
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
  paymentMethod: ["read"],
  lock: ["read", "set", "grantException"],
  export: ["read"],
  settings: ["read"],
  report: ["read", "readFinancial"],
  audit: ["read"],
  file: ["read"],
});

// The only administrator: members, invitations, settings and files.
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
  paymentMethod: ["create", "read", "update"],
  lock: ["read", "set", "grantException"],
  export: ["read"],
  settings: ["read", "update"],
  audit: ["read"],
  report: ["read", "readFinancial"],
  file: ["upload", "read", "delete"],
});

// Better Auth merges its built-in `member`/`admin`/`owner` roles into this map, but Accly
// Books authorizes only through `parseRoles`/`authorize`, which reject a stored `member`
// or `admin`; reset such rows before deploying.
export const roles = { owner, accountant, ca, operator } as const;

export type RoleKey = keyof typeof roles;

export const ROLE_LABELS: Record<RoleKey, string> = {
  owner: "Owner",
  accountant: "Accountant",
  ca: "Chartered Accountant",
  operator: "Operator",
};

export const ORG_ROLES = [
  "owner",
  "accountant",
  "ca",
  "operator",
] as const satisfies readonly RoleKey[];

export type AppPermission = Parameters<typeof roles.owner.authorize>[0];

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
