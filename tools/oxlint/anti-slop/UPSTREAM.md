# Anti-slop provenance

Source: the `install-anti-slop` skill bundle, installed on 2026-09-11. The bundle is no longer in
this repository and carried no upstream revision. Git history is the only record of the installed
bytes.

Entry point: `tools/oxlint/anti-slop/index.ts`, registered in `.oxlintrc.json` as `anti-slop`.
Every rule it registers is enabled there.

Local changes from the bundle:

- Deleted the rules that were registered but never enabled (`no-known-value-widening`,
  `no-unsafe-dictionary-type`, `no-runtime-typeof`, `no-unknown-parameters`,
  `no-shape-in-symbol-names`) and the helpers only they used.
- Deleted `no-module-mocking`. It matched only Vitest and Jest; this repository uses `bun:test`.
- Deleted the unregistered `effect/` plugin. No package declares `effect`.

Nested vendored code: `vendor/eslint-stylistic/` keeps its own `LICENSE` and `UPSTREAM.md`.

Dependencies: `@oxlint/plugins` and `oxlint` use `^1.85.0` ranges. Keep their resolved versions
compatible when updating.
