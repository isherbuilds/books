# Development

## Start locally

You need Bun 1.4.0, Node 24 (for Portless) and Docker.

```sh
bun install
cp packages/env/.env.example packages/env/.env   # then fill it in
bunx portless proxy start                         # once per machine
bun run dev
```

`bun run dev` starts PostgreSQL and SeaweedFS, migrates, and runs web, API and
docs. `dev:web` and `dev:server` need `db:up` and `db:migrate` first. One
`DATABASE_URL` serves the app, migrations, scripts and tests. React Scan loads
in development only: compare its render counts, never its timings.

## Development URLs

Web is `https://accly.localhost`, API `https://api.accly.localhost`, docs
`https://docs.accly.localhost`. Production ports are in
[Operations](./operations.md#deployment-topology).

### The dev port block

Local ports are 55443 (API), 55444 (web), 55445 (docs), 55446 (PostgreSQL) and
55447 (SeaweedFS), so another checkout can run alongside. Each app's config,
`packages/db/docker-compose.dev.yaml` (with `s3.allowedOrigins`) and the
`PORTLESS=0` fallbacks in `.env.example` declare them. With `PORTLESS=0`, point
`BETTER_AUTH_URL`, `CORS_ORIGIN` and `VITE_SERVER_URL` at localhost and remove
`BETTER_AUTH_COOKIE_DOMAIN`. A linked worktree gets prefixed hosts: set those
three values and add its web origin to `s3.allowedOrigins`, never a wildcard.

## Accounts and seed data

```sh
bun run create-founder <name> <password>       # FOUNDING_EMAIL, the only Organization creator
bun run create-user <email> <name> <password>  # an account without an invitation
bun run db:seed
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

## Commands

| Command                      | Purpose                                             |
| ---------------------------- | --------------------------------------------------- |
| `bun run dev`                | Services, migrations, all apps                      |
| `bun run dev:status`         | Read-only service and migration check               |
| `bun run check-types`        | Type-check packages and `tests/`                    |
| `bun run check`              | oxlint and oxfmt; writes formatting                 |
| `bun run test`               | Real-PostgreSQL tests; wipes `accly_test`           |
| `bun run build`              | Build all workspaces                                |
| `bun run db:up`              | Start PostgreSQL and SeaweedFS                      |
| `bun run db:generate`        | Generate a migration from the schema                |
| `bun run db:migrate`         | Apply migrations                                    |
| `bun run db:seed -- --reset` | Reset and seed; deletes local data                  |
| `bun run db:seed:volume`     | 100,000 receipts per seeded organization by default |
| `bun run db:studio`          | Drizzle Studio                                      |

`benchmark:server`, `benchmark:rpc`, `benchmark:browser` and
`benchmark:navigation` measure a running build. `benchmark:browser` times hard
page loads; `benchmark:navigation` times in-app route changes. Quote a
performance number only on `db:seed:volume` data or more.

**Check policy.** `check-types`, `check` and `test` are the repository gates. A
focused change runs the smallest existing checks that cover it. A docs-only
change runs `bunx oxfmt --check <files>`. End-user content runs
`bun run --cwd apps/fumadocs build`. An SSR or UI change needs a production
build and the running app. A read-only review never runs `check` or `test`.

Dependencies use SemVer ranges under `bun.lock`; only Bun and required peer
pairs are pinned exactly. Check each Better Auth release for schema changes
before an upgrade.

## Code rules

- Take the simplest happy path. Extract a helper at the second real call site;
  delete unused exports.
- Fail loudly on config, auth, money and data-integrity errors. No silent
  defaults or broad catches.
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
- Never hand-edit or hand-write a migration, and never hand-edit
  `routeTree.gen.ts`. The schema is the only migration source: change it, then
  run `bun run db:generate`. Before any environment keeps data, delete the
  baseline, regenerate it, and reset with `bun run db:seed -- --reset`. Once an
  environment keeps data, history is append-only.
- No secret or server-only import reaches client assets.

### React and forms

React Compiler runs through Babel; the Rust `compiler: true` option breaks
bigint literals. Extract an owner before `memo` or `useMemo`, and cite a
measurement for any that stay. `DataTable` columns live at module scope.

| Value                              | Owner                           |
| ---------------------------------- | ------------------------------- |
| Native input draft                 | The DOM (`RegisteredFormField`) |
| Widget or runtime value            | RHF (`FormField`)               |
| Server data                        | TanStack Query, never copied    |
| Search, filter, sort, columns, tab | Route search params             |
| Ephemeral text, hover              | The smallest child's `useState` |

Nothing goes to `localStorage` or `sessionStorage`.

- Forms start at `useZodForm(schema)`, and the schema coerces
  (`lib/form-schema.ts`). Money fields stay rupee text
  (`NON_NEGATIVE_MONEY_PATTERN`).
- Subscribe narrowly: `useFieldArray`, `Watch`, exact field names.
- A failed submit goes to the field the server named (`applyOrpcFieldError`);
  toast the rest.
- If the page cannot render without a query, use `loadRouteQuery` and
  `useSuspenseQuery`, and fail to the route boundary. Otherwise prefetch with
  `.catch(() => {})`, read with `useQuery`, and show an `ErrorNote` in place.
  Never both for one procedure.
- Live lists add `OPERATIONAL_REFETCH` or `OPERATIONAL_INFINITE_REFETCH`. The
  time zone comes from `useMembership`; `settings.get` needs `settings:read`.
- A failed read renders `ErrorNote`. A failed mutation toasts
  `errorMessage(error, "Could not …")`. Never print `error.message` raw.
- Writes invalidate through `lib/domain-invalidation.ts`. Remote type-ahead
  debounces before the query key. Filter locally only a complete, bounded list.

## Tests

Pure logic goes in `tests/unit`. Anything that touches a router, auth or the
database goes in `tests/integration`, on real PostgreSQL through `clientFor`.
Prefer one workflow test to many micro-tests. Use top-level `test(...)` and no
shared mutable setup; factories mint unique users and Organizations. Assert oRPC
codes, invariants and state, not copy. Use `eventually` and
`drainAuditWrites()`; never sleep. Every org-scoped domain extends
`GUARDED_CALLS` in `tests/integration/tenancy.test.ts` and proves its rows are
invisible to other tenants.

When a mistake repeats, promote the fix: doc, test, type, lint, script.
