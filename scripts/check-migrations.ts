/**
 * Fails when the committed migrations are not what `db:generate` would write
 * (hard rule 4). It drops the newest migration from a scratch copy and regenerates it
 * from the Drizzle schema under the same name. A schema change without a generated
 * migration, or a hand edit to the newest SQL, snapshot or journal entry, shows up as
 * a difference. Needs no database. Older migrations are append-only history.
 *
 * Usage: bun scripts/check-migrations.ts [migrations dir]
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type Journal = { entries: { idx: number; tag: string; when?: number }[] };

const db = resolve(import.meta.dir, "../packages/db");

const committed = resolve(process.argv[2] ?? join(db, "src/migrations"));

const scratch = mkdtempSync(join(tmpdir(), "accly-migrations-"));

const readJournal = (dir: string): Journal =>
  JSON.parse(readFileSync(join(dir, "meta/_journal.json"), "utf8"));

// The journal entry time and the snapshot id are minted fresh on every generate.
const comparable = (dir: string, tag: string, idx: string) => {
  const { id: _id, ...snapshot } = JSON.parse(
    readFileSync(join(dir, `meta/${idx}_snapshot.json`), "utf8"),
  );

  return {
    sql: readFileSync(join(dir, `${tag}.sql`), "utf8"),
    snapshot: JSON.stringify(snapshot, null, 2),
    journal: JSON.stringify(readJournal(dir).entries.map(({ when: _when, ...entry }) => entry)),
  };
};

try {
  cpSync(committed, scratch, { recursive: true });
  const journal = readJournal(scratch);
  const last = journal.entries.pop();

  if (!last) throw new Error(`No migrations in ${committed}`);
  const idx = last.tag.slice(0, 4);
  rmSync(join(scratch, `${last.tag}.sql`));
  rmSync(join(scratch, `meta/${idx}_snapshot.json`));
  writeFileSync(join(scratch, "meta/_journal.json"), JSON.stringify(journal, null, 2));

  // Mirrors packages/db/drizzle.config.ts, which cannot load without DATABASE_URL.
  const generate = Bun.spawnSync(
    [
      "bun",
      "--bun",
      "drizzle-kit",
      "generate",
      "--dialect=postgresql",
      "--schema=./src/schema",
      `--out=${scratch}`,
      `--name=${last.tag.slice(5)}`,
    ],
    { cwd: db, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );

  if (generate.exitCode !== 0) {
    throw new Error(`drizzle-kit generate failed:\n${generate.stdout}${generate.stderr}`);
  }

  const expected = comparable(scratch, last.tag, idx);
  const actual = comparable(committed, last.tag, idx);

  const drift = (["sql", "snapshot", "journal"] as const).filter(
    (part) => expected[part] !== actual[part],
  );

  if (drift.length) {
    console.error(
      `Migration drift in ${last.tag} (${drift.join(", ")}). The schema and the committed migration disagree.\n` +
        "Never hand-edit a migration: change the schema, then run `bun run db:generate` (AGENTS.md hard rule 4).",
    );
    process.exitCode = 1;
  } else {
    console.log(`Migrations match the schema (${last.tag}).`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
