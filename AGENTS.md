# Agent guidance

Accounting and billing system on a multi-tenant spine. Bun + Turborepo; TanStack Start (`apps/web`) + Hono/oRPC (`apps/server`); Drizzle + PostgreSQL; Better Auth with the organization plugin.

This file is the map plus the rules you must not break. Read the linked owner for
the behavior being changed; use the [documentation index](./docs/README.md) when
ownership is unclear. Update that owner when the change makes its guidance stale.

- [Product](./docs/product.md) — position, scope, language, evidence gates
- [Accounting core](./docs/specs/accounting-core.md) — the accounting contract and slice plan
- [Architecture](./docs/architecture.md) — tenancy, auth, requests, data, audit, files, accounting
- [Development](./docs/development.md) — setup, commands, check policy; [Operations](./docs/operations.md)
- [Design](./docs/design.md) — **the UI source of truth**
- [Current work registry](./docs/README.md#work-lifecycle) — the only list of unfinished work
- Project skills: [`lean-code`](./.agents/skills/lean-code/SKILL.md) for router/component structure, data flow, or simplification work; [`org-scoped-feature`](./.agents/skills/org-scoped-feature/SKILL.md) to add an org-scoped domain; [`tenancy-review`](./.agents/skills/tenancy-review/SKILL.md) to audit a diff for cross-tenant leaks

## Commands

Use the command table in [Development](./docs/development.md#commands). Two commands
mutate local state: `bun run check` writes formatting and `bun run test` wipes
`accly_test`. A read-only review uses non-mutating checks appropriate to the change:
`bunx oxlint`, `bunx oxfmt --check`, type checks, or tests verified not to change
source files or shared data. Do not run writing formatters or database-wiping tests
as part of a read-only review.
One session at a time owns a database-wiping test run.

## Stage

Pre-production code: no backward compatibility, deprecated aliases, or shims (see
`lean-code`). Migrations follow hard rule 4.

## Runtime check

Run this before reporting UI, route, or API work.

1. `docker info` fails → `open -ga Docker`, then retry until it answers.
2. `bun run dev:status`. Web or API down → start `bun run dev` once as a background
   process owned by the main session (it runs `db:up` and `db:migrate` first). Portless
   needs its proxy started once per machine ([Development](./docs/development.md)).
3. "Migrations unverified" means the local database follows another branch or
   worktree. Report it and ask before `bun run db:seed -- --reset`, which drops the
   dev schema.
4. Empty database → `bun run db:seed` (then `db:seed:demo` for workflow cases). Sign
   in at `https://accly.localhost/login` as `owner@example.com` / `password123`
   (also `accountant@` and `operator@`; local seed only).
5. Drive the changed path with populated data at a phone and a desktop width, and in
   dark theme where the screen has one. A redirect to `/login` after step 4 is a
   blocker to report, not a pass.
6. Teardown: stop only what you started. Killing the `bun run dev` wrapper leaves the
   portless children holding the URLs, so stop the listeners on the dev port block
   ([Development](./docs/development.md)) if you started them.

## Hard rules

1. **Every domain row belongs to exactly one org (`orgId NOT NULL`), and every query carries the tenant predicate `eq(orgId, scope.orgId)`.** This includes infrastructure tables (`audit_log`, `file`). `userId` columns are attribution, never scope.
2. **Org context is explicit procedure input, proven by the permission guard.** Org pages pass their `/:orgSlug` route param as `input.orgSlug` through the single `/rpc` client. `orgProcedure(permission, input)` resolves membership in its internal guard and turns the claim into verified `context.scope`; the permission is a required constructor argument and the raw builder is not exported. Handlers use only scope for authorization and SQL. Membership resolves once per request and never across requests; there is no fallback to `session.activeOrganizationId`.
   - Org pages live under `apps/web/src/routes/$orgSlug/` and import the singleton `orpc`. Every org query, mutation, and invalidation includes `orgSlug`, so query keys cannot reuse another tenant's data. Slugs are validated by `@accly/auth/organization-slug`. The layout server-renders; its loader fetches `member.me` through the request-local server client. Base UI popups stay behind `ClientOnly`.
   - Public sign-up is closed. An account is created only by native sign-up carrying a live invitation id for that email, or by an operator via `scripts/create-user.ts`. The invitation id is the recipient's proof until an email provider exists, so it reaches only members with the invite grant. Only the `FOUNDING_EMAIL` account creates organizations (`scripts/create-founder.ts`).
   - Roles are stored comma-joined and authorize as a **union**. Use `parseRoles`/`authorize` from `@accly/auth/access`; never read `role.split(",")[0]`.
3. **Audit sensitive actions, not everything.** `audit()` is fire-and-forget and can never slow a response or turn one into a 500. Role denials are audited centrally in `orgProcedure`; routers call `audit()` only for sensitive or destructive mutations. Do not move audit writes into domain transactions.
4. **Never hand-edit or hand-write migrations.** The Drizzle schema is the only source: change it, then `bun run db:generate`. A rule Drizzle cannot express is not built. Extensions the schema needs (`pg_trgm`) are created by `runMigrations`, never by a migration file. Before any environment keeps data, delete the baseline, regenerate it and reset the database; once data is retained, migrations are append-only.
5. **Permissions live in `packages/auth/src/access.ts` only.** Dependency-free, shared by client and server. Each role states its grants explicitly.
6. **No secrets or server-only modules in client assets.**
7. **Stored objects are always private.** `@accly/storage` issues only short-lived presigned URLs; the bucket is never anonymously readable.

## Rule enforcement

A rule with only `prose` behind it that an agent breaks again moves up a level in the same change.

| Rule                                                                   | Enforced by                                                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| All checks below run before a commit and before an agent stops         | `bun run verify` in `.githooks/pre-commit` and the `.claude/settings.json` Stop hook |
| Tenant predicate, scope-only authorization (rules 1–2)                 | test `tests/integration/tenancy.test.ts`                                             |
| Every domain table has `org_id NOT NULL` (rule 1)                      | test `tests/unit/schema-org-id.test.ts`                                              |
| Permission passed to `orgProcedure`, not checked in a handler (rule 2) | lint `accly/no-permission-in-handler`                                                |
| Roles authorize as a union (rule 2)                                    | `@accly/auth/access` is the only parser; test `tests/unit/access.test.ts`            |
| Migrations come from `db:generate` (rule 4)                            | `bun run db:check`                                                                   |
| No server-only module in client code (rule 6)                          | lint `accly/client-safe-imports`; allowlist in `tools/oxlint/accly/client-safe.ts`   |
| Settlement roles come from `core/document-roles.ts`                    | lint `accly/no-exposure-side-branch`                                                 |
| Money sums go through `paiseSum`                                       | lint `accly/no-raw-paise-sum`                                                        |
| No bigint literal in `.tsx`                                            | lint `accly/no-bigint-in-components`                                                 |
| No paise maths in components                                           | lint `accly/no-paise-arithmetic-in-components`                                       |
| No non-null assertion in `packages/api` and `apps/web`                 | lint `typescript/no-non-null-assertion`                                              |
| Query options live in `apps/web/src/lib`; paging uses `nextPage`       | lint `accly/query-options-in-lib`, `accly/paging-from-orpc`                          |
| PDF links are typed routes, not `/api/` strings                        | lint `accly/no-api-url-literal`                                                      |
| Failed writes go through `handleWriteError`                            | lint `accly/write-errors-via-handler`                                                |
| No manual memoization (React Compiler)                                 | lint `accly/no-manual-memo`                                                          |
| No transition or animation class outside overlays (design §11)         | lint `accly/no-motion-on-controls`; overlays exempt in `.oxlintrc.json`              |
| No function that only forwards its parameters to one call              | lint `accly/no-pass-through-function`                                                |
| Files stay under 800 code lines                                        | lint `max-lines` (warning)                                                           |
| Each `accly` rule flags its bad fixture and passes its good one        | test `tests/unit/lint-rules.test.ts`                                                 |
| Base UI `data-pressed:` not Radix `data-[state=…]:` (UI)               | `prose`; no occurrence in the tree yet                                               |
| Agent never stages or commits                                          | `prose` (personal guidance)                                                          |

## How to work

Personal guidance covers ownership, reviews, git, testing, and verification; this
file adds the project rules.

- Run `bun run verify` before finishing; the Stop hook runs it.
- Fail loud on config, auth, money, and data-integrity errors: no defaults, no broad catches.
- Irreversible operations need confirmation right before execution. Git revert, branch switch, running tests, and read-only analysis are not irreversible.
- Missing runtime evidence is Verification, not completion: record the blocker and next action in the [work registry](./docs/README.md#work-lifecycle).

## UI

- `packages/ui` is `shadcn` `base-lyra` on Base UI. Use the type, control size and radius rules in `docs/design.md` §§3–4.
- Base UI primitives emit `data-pressed`, `data-checked`, `data-disabled`, never Radix's `data-state="on"`. A `data-[state=…]:` variant styles nothing; use `data-pressed:` / `data-checked:`. `shadcn/tailwind.css` redefines `data-selected:` as `="true"` for cmdk, so a Base UI selected item needs `data-[selected]:`.
- cmdk (the command palette only) emits `data-selected` and `data-disabled` as `"true"`/`"false"` on every item, so style them with `data-[selected=true]:`, never a bare `data-selected:`. Never use cmdk's Radix `Command.Dialog`; compose the Base UI Dialog.
- All-day console, so motion is rationed: none on frequent or keyboard-driven actions; `ease-out` enter/exit under 200ms only where it carries spatial continuity. `prefers-reduced-motion` is honoured globally.
- Keyboard focus comes from an unlayered `:focus-visible` rule in `globals.css`; do not remove it. Hover effects are gated to `(hover: hover) and (pointer: fine)`.
