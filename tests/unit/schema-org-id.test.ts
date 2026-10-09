import { expect, test } from "bun:test";

import * as schema from "@accly/db/schema/index";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";

// Better Auth owns these tables; `member` and `invitation` scope by `organization_id`.
const AUTH_TABLES = [
  "user",
  "session",
  "account",
  "verification",
  "organization",
  "member",
  "invitation",
];

test("every domain table has a NOT NULL org_id (hard rule 1)", () => {
  const tables = Object.values(schema)
    .filter((value) => value instanceof PgTable)
    .map((table) => getTableConfig(table))
    .filter((table) => !AUTH_TABLES.includes(table.name));

  expect(tables.length).toBeGreaterThan(15);

  const unscoped = tables.filter(
    (table) => !table.columns.some((column) => column.name === "org_id" && column.notNull),
  );

  expect(unscoped.map((table) => table.name)).toEqual([]);
});
