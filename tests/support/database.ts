import pg from "pg";

import { drainAuditWrites } from "@accly/api/audit";
import { runMigrations } from "@accly/db/migrate";

export async function resetTestDatabase(): Promise<void> {
  await drainAuditWrites();

  const databaseUrl = new URL(process.env.DATABASE_URL!);
  const databaseName = databaseUrl.pathname.slice(1);

  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing to reset "${databaseName}": integration tests only run against a *_test database.`,
    );
  }

  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();

  try {
    const exists = await admin.query("select 1 from pg_database where datname = $1", [
      databaseName,
    ]);

    if (exists.rowCount === 0) {
      await admin.query(`create database "${databaseName.replaceAll('"', '""')}"`);
    }
  } finally {
    await admin.end();
  }

  const client = new pg.Client({ connectionString: databaseUrl.toString() });
  await client.connect();

  try {
    // Drop the "drizzle" schema too, or the migrator considers everything applied.
    await client.query(
      "drop schema public cascade; create schema public; drop schema if exists drizzle cascade;",
    );
  } finally {
    await client.end();
  }

  await runMigrations();
}
