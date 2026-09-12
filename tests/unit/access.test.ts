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
    admin: granted.includes("admin"),
    accountant: granted.includes("accountant"),
    ca: granted.includes("ca"),
    operator: granted.includes("operator"),
    reception: granted.includes("reception"),
    cashier: granted.includes("cashier"),
  };
}

const ALL_ROLES = [
  "owner",
  "admin",
  "accountant",
  "ca",
  "operator",
  "reception",
  "cashier",
] as const;

const ADMINISTRATORS = ["owner", "admin"] as const;

const ACCOUNTING_WRITERS = ["owner", "admin", "accountant"] as const;

const LEGACY_READERS = ["owner", "admin", "accountant", "reception", "cashier"] as const;

const MATRIX: MatrixRow[] = [
  matrix({ settings: ["read"] }, ALL_ROLES),
  matrix({ settings: ["update"] }, ADMINISTRATORS),
  matrix({ audit: ["read"] }, ["owner", "admin", "accountant", "ca"]),
  matrix({ report: ["readDailyCollections"] }, ["owner", "admin", "accountant", "cashier"]),
  matrix({ report: ["readOpdRegister"] }, ACCOUNTING_WRITERS),
  matrix({ report: ["readFinancial"] }, ["owner", "admin", "accountant", "ca"]),
  matrix({ item: ["read"] }, ALL_ROLES),
  matrix({ item: ["create"] }, ACCOUNTING_WRITERS),
  matrix({ item: ["update"] }, ACCOUNTING_WRITERS),
  matrix({ payer: ["read"] }, LEGACY_READERS),
  matrix({ payer: ["create"] }, ADMINISTRATORS),
  matrix({ staff: ["read"] }, LEGACY_READERS),
  matrix({ staff: ["create"] }, ADMINISTRATORS),
  matrix({ staff: ["update"] }, ADMINISTRATORS),
  matrix({ file: ["upload"] }, ["owner", "admin", "reception"]),
  matrix({ file: ["read"] }, ALL_ROLES),
  matrix({ file: ["delete"] }, ADMINISTRATORS),
  matrix({ member: ["read"] }, ALL_ROLES),
  matrix({ member: ["create"] }, ADMINISTRATORS),
  matrix({ member: ["update"] }, ADMINISTRATORS),
  matrix({ member: ["delete"] }, ADMINISTRATORS),
  matrix({ invitation: ["create"] }, ADMINISTRATORS),
  matrix({ invitation: ["cancel"] }, ADMINISTRATORS),
  matrix({ organization: ["update"] }, ADMINISTRATORS),
  matrix({ organization: ["delete"] }, ["owner"]),
  matrix({ customer: ["create"] }, ["owner", "admin", "reception"]),
  matrix({ customer: ["read"] }, LEGACY_READERS),
  matrix({ customer: ["update"] }, ["owner", "admin", "reception"]),
  matrix({ opd: ["create"] }, ["owner", "admin", "reception"]),
  matrix({ opd: ["read"] }, LEGACY_READERS),
  matrix({ opd: ["update"] }, ["owner", "admin", "reception"]),
  matrix({ billing: ["read"] }, LEGACY_READERS),
  matrix({ billing: ["write"] }, ["owner", "admin", "reception", "cashier"]),
  matrix({ billing: ["creditNote"] }, ACCOUNTING_WRITERS),
  matrix({ receipt: ["post"] }, ["owner", "admin", "accountant", "operator"]),
  matrix({ receipt: ["cancel"] }, ACCOUNTING_WRITERS),
  matrix({ party: ["create"] }, ACCOUNTING_WRITERS),
];

test("each role grants exactly the permissions the matrix declares", () => {
  expect(Object.keys(roles).sort()).toEqual([...ORG_ROLES].sort());

  const granted = MATRIX.map((row) => ({
    permission: row.permission,
    owner: authorize(["owner"], row.permission),
    admin: authorize(["admin"], row.permission),
    accountant: authorize(["accountant"], row.permission),
    ca: authorize(["ca"], row.permission),
    operator: authorize(["operator"], row.permission),
    reception: authorize(["reception"], row.permission),
    cashier: authorize(["cashier"], row.permission),
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
  expect(parseRoles("reception,cashier")).toEqual(["reception", "cashier"]);
  expect(parseRoles(" owner , accountant ")).toEqual(["owner", "accountant"]);
  expect(parseRoles("ca,operator")).toEqual(["ca", "operator"]);

  expect(() => parseRoles("member")).toThrow(/Unknown organization role/);
  expect(() => parseRoles("toString")).toThrow(/Unknown organization role/);
  expect(() => parseRoles("superadmin")).toThrow(/Unknown organization role/);
  expect(() => parseRoles("reception,superadmin")).toThrow(/Unknown organization role/);
});

test("authorize grants the union across roles, matching Better Auth's own semantics", () => {
  // The bug this guards: reading only the first role strips a multi-role member's
  // permissions.
  expect(authorize(parseRoles("reception"), { audit: ["read"] })).toBe(false);
  expect(authorize(parseRoles("reception,accountant"), { audit: ["read"] })).toBe(true);
  expect(authorize(parseRoles("reception,admin"), { file: ["delete"] })).toBe(true);

  expect(authorize(["reception"], { organization: ["delete"] })).toBe(false);
  expect(authorize([], { settings: ["read"] })).toBe(false);
});
