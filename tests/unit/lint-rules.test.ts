import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import accly from "../../tools/oxlint/accly/index.ts";

// Every accly rule has a fixture pair in tests/fixtures/lint: `<rule>.bad.<ext>` must be
// flagged by that rule and `<rule>.good.<ext>` must not. A new rule needs only the pair.
const root = resolve(import.meta.dir, "../..");

const fixtures = join(root, "tests/fixtures/lint");

const rules = Object.keys(accly.rules ?? {});

const scratch = mkdtempSync(join(tmpdir(), "accly-lint-"));

const config = join(scratch, ".oxlintrc.json");

writeFileSync(
  config,
  JSON.stringify({
    categories: { correctness: "off" },
    jsPlugins: [{ name: "accly", specifier: join(root, "tools/oxlint/accly/index.ts") }],
    rules: Object.fromEntries(rules.map((rule) => [`accly/${rule}`, "error"])),
  }),
);

const lint = Bun.spawnSync(["bunx", "oxlint", "-c", config, "-f", "json", fixtures], {
  cwd: root,
});

rmSync(scratch, { recursive: true });

// SAFETY: `oxlint -f json` prints one object whose `diagnostics` carry `code` and `filename`.
const { diagnostics } = JSON.parse(lint.stdout.toString()) as {
  diagnostics: { code: string; filename: string }[];
};

const files = readdirSync(fixtures);

const flagged = (rule: string, kind: "bad" | "good") => {
  const file = files.find((name) => name.startsWith(`${rule}.${kind}.`));

  if (!file) throw new Error(`Missing fixture tests/fixtures/lint/${rule}.${kind}.*`);

  return diagnostics.some(
    (diagnostic) => diagnostic.code === `accly(${rule})` && diagnostic.filename.endsWith(file),
  );
};

for (const rule of rules) {
  test(`accly/${rule} flags its bad fixture and passes its good one`, () => {
    expect(flagged(rule, "bad")).toBe(true);
    expect(flagged(rule, "good")).toBe(false);
  });
}
