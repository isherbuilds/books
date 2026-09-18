# Anti-slop provenance

Source: the `install-anti-slop` skill bundle at `.agents/skills/install-anti-slop/assets/anti-slop`
(`.claude/skills/install-anti-slop` is a symlink to it). Installed on 2026-09-11 with
`scripts/install.mjs`.

Upstream repository and commit: unknown. The skill bundle carries no upstream revision, and it
was not yet committed in this repository at install time, so no Git revision identifies it.

Pristine snapshot digest: `b87f754c9e810f6cfadaf83eb0e521cd10b54f263234744b2f0db296f40c5596`
(SHA-256 over the sorted `shasum -a 256` listing of all 38 files in the bundle). The digest
identifies the copied bytes; it cannot reconstruct them. Once the skill bundle is committed, its
commit is the recoverable pristine base for future updates.

Installed entry points:

- `tools/oxlint/anti-slop/index.ts` — generic plugin, registered in `.oxlintrc.json` as `anti-slop`.
- `tools/oxlint/anti-slop/effect/index.ts` — copied but not registered; no package declares `effect`.

Nested vendored code: `vendor/eslint-stylistic/` keeps its own `LICENSE` and `UPSTREAM.md`.

Dependencies: `@oxlint/plugins` and `oxlint` use `^1.82.0` ranges. Keep their resolved
versions compatible when updating.

Intentional deviations from the bundle: the nested Stylistic provenance note records the local
verification commands. Rule source matches the bundled snapshot.
