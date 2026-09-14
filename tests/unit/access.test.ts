import { expect, test } from "bun:test";

import {
  ORG_ROLES,
  authorize,
  parseRoles,
  roles,
  type AppPermission,
  type RoleKey,
} from "@accly/auth/access";

type MatrixRow = { permission: AppPermission } & Record<RoleKey, boolean>;

function matrix(permission: AppPermission, granted: readonly RoleKey[]): MatrixRow {
  return {
    permission,
    owner: granted.includes("owner"),
    accountant: granted.includes("accountant"),
    ca: granted.includes("ca"),
    operator: granted.includes("operator"),
  };
}

const ALL_ROLES = ["owner", "accountant", "ca", "operator"] as const;

const ACCOUNTING_WRITERS = ["owner", "accountant"] as const;

const READERS_OF_BOOKS = ["owner", "accountant", "ca"] as const;

const MATRIX: MatrixRow[] = [
  matrix({ settings: ["read"] }, ALL_ROLES),
  matrix({ settings: ["update"] }, ["owner"]),
  matrix({ audit: ["read"] }, READERS_OF_BOOKS),
  matrix({ export: ["read"] }, READERS_OF_BOOKS),
  matrix({ report: ["read"] }, READERS_OF_BOOKS),
  matrix({ report: ["readFinancial"] }, READERS_OF_BOOKS),
  matrix({ file: ["upload"] }, ["owner"]),
  matrix({ file: ["read"] }, ALL_ROLES),
  matrix({ file: ["delete"] }, ["owner"]),
  matrix({ member: ["read"] }, ALL_ROLES),
  matrix({ member: ["create"] }, ["owner"]),
  matrix({ member: ["update"] }, ["owner"]),
  matrix({ member: ["delete"] }, ["owner"]),
  matrix({ invitation: ["create"] }, ["owner"]),
  matrix({ invitation: ["cancel"] }, ["owner"]),
  matrix({ organization: ["update"] }, ["owner"]),
  matrix({ organization: ["delete"] }, ["owner"]),
  matrix({ receipt: ["post"] }, ["owner", "accountant", "operator"]),
  matrix({ receipt: ["cancel"] }, ACCOUNTING_WRITERS),
  matrix({ party: ["create"] }, ACCOUNTING_WRITERS),
  matrix({ account: ["create"] }, ACCOUNTING_WRITERS),
  matrix({ paymentMethod: ["update"] }, ACCOUNTING_WRITERS),
];

test("each role grants exactly the permissions the matrix declares", () => {
  expect(Object.keys(roles).sort()).toEqual([...ORG_ROLES].sort());

  const granted = MATRIX.map((row) => ({
    permission: row.permission,
    owner: authorize(["owner"], row.permission),
    accountant: authorize(["accountant"], row.permission),
    ca: authorize(["ca"], row.permission),
    operator: authorize(["operator"], row.permission),
  }));

  expect(granted).toEqual(MATRIX);
});

test("the CA reads documents but never posts them", () => {
  const documents: Array<{ read: AppPermission; post: AppPermission }> = [
    { read: { receipt: ["read"] }, post: { receipt: ["post"] } },
    { read: { payment: ["read"] }, post: { payment: ["post"] } },
    { read: { invoice: ["read"] }, post: { invoice: ["post"] } },
    { read: { bill: ["read"] }, post: { bill: ["post"] } },
    { read: { note: ["read"] }, post: { note: ["post"] } },
    { read: { journal: ["read"] }, post: { journal: ["post"] } },
    { read: { openingBalance: ["read"] }, post: { openingBalance: ["post"] } },
  ];

  for (const document of documents) {
    expect(authorize(["ca"], document.read)).toBe(true);
    expect(authorize(["ca"], document.post)).toBe(false);
  }
});

test("the operator can post receipts without cancellation or master creation", () => {
  expect(authorize(["operator"], { receipt: ["post"] })).toBe(true);
  expect(authorize(["operator"], { receipt: ["cancel"] })).toBe(false);
  expect(authorize(["operator"], { party: ["create"] })).toBe(false);
});

test("parseRoles reads every stored role and rejects ones this app does not define", () => {
  expect(parseRoles("operator,ca")).toEqual(["operator", "ca"]);
  expect(parseRoles(" owner , accountant ")).toEqual(["owner", "accountant"]);

  // Better Auth's own `member` and `admin` roles, and the removed legacy roles, fail closed.
  for (const stored of ["member", "admin", "reception", "toString", "operator,superadmin"]) {
    expect(() => parseRoles(stored)).toThrow(/Unknown organization role/);
  }
});

test("authorize grants the union across roles, matching Better Auth's own semantics", () => {
  // The bug this guards: reading only the first role strips a multi-role member's
  // permissions.
  expect(authorize(parseRoles("operator"), { audit: ["read"] })).toBe(false);
  expect(authorize(parseRoles("operator,accountant"), { audit: ["read"] })).toBe(true);
  expect(authorize(parseRoles("operator,owner"), { file: ["delete"] })).toBe(true);

  expect(authorize(["operator"], { organization: ["delete"] })).toBe(false);
  expect(authorize([], { settings: ["read"] })).toBe(false);
});
