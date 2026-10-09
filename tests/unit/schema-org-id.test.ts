import { expect, test } from "bun:test";
import { join } from "node:path";

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

// drizzle.config.ts reads the whole schema directory, so this scans it too, not the barrel.
const schemaDir = join(import.meta.dir, "../../packages/db/src/schema");

test("every domain table has a NOT NULL org_id (hard rule 1)", async () => {
  const byName = new Map<string, ReturnType<typeof getTableConfig>>();

  for await (const file of new Bun.Glob("*.ts").scan(schemaDir)) {
    const module: Record<string, unknown> = await import(join(schemaDir, file));

    for (const value of Object.values(module)) {
      if (!(value instanceof PgTable)) continue;
      const table = getTableConfig(value);
      byName.set(table.name, table);
    }
  }

  const tables = [...byName.values()].filter((table) => !AUTH_TABLES.includes(table.name));

  expect(tables.length).toBeGreaterThan(15);

  const unscoped = tables.filter(
    (table) => !table.columns.some((column) => column.name === "org_id" && column.notNull),
  );

  expect(unscoped.map((table) => table.name)).toEqual([]);
});
