# Development

## Start locally

You need the Bun version `packageManager` pins in `package.json`, Node 24 or
later (Portless declares `node >=24`), and Docker. Start the Portless proxy
through its Node shebang so it serves certificates for nested `.localhost`
names. `bunx portless proxy start` runs the proxy with Bun and serves the
default certificate for those names. Other tools
with a `node` shebang (Vite, tsc, tsdown, Astro, drizzle-kit, Turborepo, oxlint)
run as `bun --bun <tool>` in the package scripts. A new script that calls one
follows suit.

```sh
bun install
cp packages/env/.env.example packages/env/.env   # then fill it in
./node_modules/.bin/portless proxy start        # once per machine; runs with Node
bun run dev
```

`bun run dev` starts PostgreSQL and SeaweedFS, migrates, and runs web, API and
docs. `dev:web` and `dev:server` need `db:up` and `db:migrate` first. One
`DATABASE_URL` serves the app, migrations, scripts and tests. Profile renders
only when investigating a measured interaction; instrumentation changes timings.

## Development URLs

Web is `https://accly.localhost`, API `https://api.accly.localhost`, docs
`https://docs.accly.localhost/docs`. A production web build serves the docs'
static output at `/docs` on the app domain. Production ports are in
[Operations](./operations.md#deployment-topology).

### The dev port block

Local ports are 55443 (API), 55444 (web), 55445 (docs), 55446 (PostgreSQL) and
55447 (SeaweedFS), so another checkout can run alongside. Each app's config,
`packages/db/docker-compose.dev.yaml` (with `s3.allowedOrigins`) and the
`PORTLESS=0` fallbacks in `.env.example` declare them; each app's `portless`
`appPort` pins the same port behind the proxy. With `PORTLESS=0`, point
`BETTER_AUTH_URL`, `CORS_ORIGIN` and `VITE_SERVER_URL` at localhost and remove
`BETTER_AUTH_COOKIE_DOMAIN`. A linked worktree gets prefixed hosts: set those
three values and add its web origin to `s3.allowedOrigins`, never a wildcard.

## Accounts and seed data

```sh
bun run create-founder <name> <password>       # FOUNDING_EMAIL, the only Organization creator
bun run create-user <email> <name> <password>  # an account without an invitation
bun run db:seed
bun run db:seed:demo # add or complete the practical cases after db:seed
bun run db:seed:mega # fill Meridian Traders to 1M documents
```

Organization creation runs one bootstrap (`core/organizations.ts`): settings,
chart, payment methods, TDS sections and Tax Rates. `db:seed` fills an empty
database with
users, a pending invitation, Meridian Traders (company) and Ridgeview Academy
(trust). `owner@example.com` owns both Organizations. `accountant@example.com`
is an accountant and reads the audit log. `operator@example.com` is an
operator; the audit log refuses it, and the refusal is audited. The pending
invitation is for the operator role. Each Organization has HDFC and ICICI bank
accounts, the cash box, and the methods HDFC UPI, HDFC NEFT, HDFC card machine,
ICICI NEFT, ICICI cheque and Cash. Receipts from the financial-year start, at
most six months back, post through the real core, each into the account of its
method.

The seed also creates Cedar Components, a GST-registered trading company with
six named parties and three Items. Its marked cases cover Invoice and Bill drafts,
local, interstate and B2B sales, a split-payment counter sale, an overdue part-paid
Invoice, an advance applied to an Invoice, eligible and ineligible Bill ITC,
contractor TDS, direct and against Payments, a supplier advance, direct and
cancelled Receipts, both Note types, an Opening Balance and a cash deposit
Journal. `db:seed:demo` finds its marked cases before writing, so a rerun completes
a partial seed without duplicates.

`db:seed:mega` fills Meridian Traders to 1,000,000 total documents, the volume
the query-performance measurements use; the other organizations keep their base
and demo seeds. Document ids are UUIDv7-shaped and dates rise with the document
number across the financial year, so newest-first `id` order matches production.
Each 20-document
cycle includes Invoices, Receipts, Bills, Credit Notes, Debit Notes and
Payments. The rows include balanced journal entries, party ledger entries,
settlement allocations, multiple receipts and payments against one document,
and cancelled documents with reversal entries. It uses batched PostgreSQL
`INSERT ... SELECT` statements, keeps constraints and indexes enabled, commits
each batch and resumes from its last committed batch. Run `db:seed` first.
These are synthetic posted rows for volume reads and reports. Use
`db:seed:demo` for workflow correctness cases. The mega seed only connects to
`localhost:55446/postgres` and refuses locked organizations. The fill writes
about 6.5 million rows across documents, document lines, journal entries and
lines, party ledger lines and allocations, in about 10 minutes.

To stop the local PostgreSQL and SeaweedFS containers and delete their volumes,
run `bun run db:down:clean -- --confirm-delete-local-volumes`. This removes the
local database and file-store data. The command refuses non-local Docker contexts.

## Commands

| Command                                                   | Purpose                                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------- |
| `bun run dev`                                             | Services, migrations, all apps                                              |
| `bun run dev:status`                                      | Read-only service and migration check                                       |
| `bun run verify`                                          | Read-only gate: lint, format check, types, migration drift                  |
| `bun run check-types`                                     | Type-check packages, `tests/`, `scripts/` and `tools/`                      |
| `bunx oxlint`                                             | Non-writing lint check                                                      |
| `bunx oxfmt --check .`                                    | Non-writing repository format check                                         |
| `bun run check`                                           | Run oxlint, then write formatting                                           |
| `bun run test`                                            | Real-PostgreSQL and SeaweedFS tests; wipes `*_test`                         |
| `bun run build`                                           | Production-build all workspaces                                             |
| `bun run db:up`                                           | Start PostgreSQL and SeaweedFS                                              |
| `bun run db:generate`                                     | Generate a migration from the schema                                        |
| `bun run db:check`                                        | Fail if migrations differ from what `db:generate` writes; no database       |
| `bun run knip`                                            | Unused files, exports and dependencies (knip brings its own TypeScript 5)   |
| `bun run db:migrate`                                      | Apply migrations                                                            |
| `bun run db:seed -- --reset`                              | Reset and seed; deletes local data                                          |
| `bun run db:seed:volume`                                  | 100,000 receipts each for Meridian Traders and Ridgeview Academy by default |
| `bun run db:seed:mega`                                    | Fill Meridian Traders to 1M total documents                                 |
| `bun run db:down:clean -- --confirm-delete-local-volumes` | Stop local services and delete their volumes                                |
| `bun run db:seed:demo`                                    | Add or complete the practical Cedar Components cases                        |
| `bun run db:studio`                                       | Drizzle Studio                                                              |

`benchmark:server`, `benchmark:rpc`, `benchmark:browser` and
`benchmark:navigation` measure a running build. `benchmark:browser` times hard
page loads; `benchmark:navigation` times in-app route changes. `benchmark:rpc`
times every API read by route: session and settings, masters, balances, party
tabs and pickers, each register's pages, party filter and searches, document
views, reports, day book, exports and oversized-report refusals. It checks
every response before it counts, so a wrong answer stops the run. Set
`PERF_WRITES=1` to add inserts, updates, draft upserts and deletes, posts,
cancels and allocations; these write real documents into the fixture. It picks
its ids and search terms from the data. `PERF_SCENARIOS` runs only the named
scenarios and refuses an unknown name; `PERF_RPC_REQUESTS` (30) and
`PERF_RPC_WARMUP` (5) set the counts; `PERF_OTHER_ORG_TERM` adds a search for
another organization's party name. `PERF_ORG_SLUG` defaults to `meridian-traders`, the mega-seeded
organization. The JSON report goes to
stdout and one checked line per scenario to stderr. Quote a performance number
only on `db:seed:volume` data or more.

**Check policy.** Deployment is manual. GitHub Actions is disabled; this
repository has no CI/CD workflows or required automated status checks. `bun run
verify` is the read-only gate. `bun install` points `core.hooksPath` at
`.githooks`, whose pre-commit hook runs it, and `.claude/settings.json` runs it
when an agent stops and returns any failure to the agent. Tests stay out of both
hooks because they wipe the test database. Run the checks appropriate to each
change before pushing. `bun run check` is a local fixer because it writes
formatting. A focused change runs the
smallest existing checks that cover it. A docs-only change runs `bunx oxfmt
--check <files>`. End-user content runs `bun run --cwd apps/docs build`. An
SSR or UI change needs a production build and the running app. A read-only
review never runs `check` or `test`.

The web build passes and hashes `VITE_*` through Turborepo and hashes
`packages/env/.env*` as an input. Inject server-only settings when starting the
built server; do not expose them through public Vite variables.

Package dependencies use SemVer ranges; `bun.lock` records resolved versions.
Keep required peer pairs compatible when updating them. Bun's runtime version
stays pinned. Check each Better Auth release for schema changes before an upgrade.

## Code rules

Follow the [repository hard rules](../AGENTS.md#hard-rules).

- Money is `bigint` paise end to end. Rounding is half-up through the one
  `divideHalfUp` in `core/money.ts`, which tax, round-off and TDS share.
  Display with `formatMoney` and write plain text with `formatDecimal`. Input is
  rupee text that the `money` fragment parses once (13-digit cap on input only).
- `sum()` returns `numeric` and `db.execute` returns `int8` as text: cast to
  `bigint` in SQL and read with `BigInt(...)`.
- `JSON.stringify` throws on `bigint`, so audit metadata and query inputs hold
  decimal text. Amounts become numbers only in XLSX cells.
- Use named function declarations, arrows for callbacks, named exports, `type`
  aliases and `satisfies`.
- `null` means absent; `undefined` means omitted. Never both in one contract.
- Comment why the obvious approach is wrong.
- Never hand-edit `routeTree.gen.ts`. Migration generation follows the
  [repository migration rule](../AGENTS.md#hard-rules): regenerate the
  pre-production baseline, then reset with `bun run db:seed -- --reset` only
  with explicit approval immediately before deleting local data.

### React and forms

React Compiler runs through oxc (`viteReact({ compiler: true })`), whose pass
rewrites bigint literals inside a component to `undefined`. Amounts therefore go
through `@accly/api/core/money` helpers, and `oxlint` bans bigint literals in
`.tsx`. The compiler also memoizes, so `accly/no-manual-memo` bans `useMemo`,
`useCallback` and `memo` in `apps/web` and `packages/ui`. `DataTable` columns
live at module scope.

| Value                              | Owner                           |
| ---------------------------------- | ------------------------------- |
| Native input draft                 | The DOM (`RegisteredFormField`) |
| Widget or runtime value            | RHF (`FormField`)               |
| Server data                        | TanStack Query, never copied    |
| Search, filter, sort, columns, tab | Route search params             |
| Ephemeral text, hover              | The smallest child's `useState` |

Nothing goes to `localStorage` or `sessionStorage`.

- Forms start at `useZodForm(schema)`. Shared field fragments live in
  `lib/form-schema.ts`: a money field stays rupee text, and `positiveAmount`
  judges it in paise, never through `Number()`.
- Subscribe narrowly: `useFieldArray`, `Watch`, exact field names.
- A failed submit goes to the field the server named (`applyOrpcFieldError`);
  toast the rest.
- Query loading, refresh, read/write errors and invalidation follow
  [Client patterns](./specs/client-patterns.md#queries-and-invalidation).

## Tests

Pure logic goes in `tests/unit`. Anything that touches a router, auth or the
database goes in `tests/integration`, on real PostgreSQL through `clientFor`.
Tests wipe only a database whose name ends in `_test`.
Prefer one workflow test to many micro-tests. Use top-level `test(...)` and no
shared mutable setup; factories mint unique users and Organizations. Assert oRPC
codes, invariants and state, not copy. Use `eventually` and
`drainAuditWrites()`; never sleep. Every org-scoped domain extends
`GUARDED_CALLS` in `tests/integration/tenancy.test.ts` and proves its rows are
invisible to other tenants.

The lock-form identity regression uses the existing browser tooling:
`bun scripts/check-lock-form.ts <fixture Locks URL>`. Select a signed-in browser
page through `chrome-devtools-axi` in `CHROME_DEVTOOLS_AXI_SESSION` first.
Run once with both lock dates equal (both unlocked is sufficient) and once with
different dates. It switches the mounted Dialog from Books to Tax, checks fresh
drafts and the outgoing CAS snapshot, and intercepts submission without saving.
Network requests stay blocked in that document, including after a failed check.
Reload the page afterward to restore normal operation.

Each `accly` lint rule has a fixture pair in `tests/fixtures/lint`:
`<rule>.bad.<ext>` must be flagged and `<rule>.good.<ext>` must not.
`tests/unit/lint-rules.test.ts` fails when a rule has no pair.

When a mistake repeats, promote the fix: doc, test, type, lint, script.
