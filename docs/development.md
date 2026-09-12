# Development

## Start locally

Prerequisites: Bun 1.4.0 (pinned in `package.json`), Node 24 (used by Portless),
and Docker.

```sh
bun install
cp packages/env/.env.example packages/env/.env
# Once per machine — generates a local CA, trusts it, and binds port 443:
bunx portless proxy start
# Fill in the environment file, then:
bun run dev
```

The root `dev` command starts the local PostgreSQL/SeaweedFS stack, applies
migrations, and runs the web, API, and end-user-docs workspace tasks. `dev:web`
and `dev:server` run only the selected Turbo task, so use `db:up` and
`db:migrate` first when invoking either directly.

### Database connection and migrations

The pre-production MVP uses one `DATABASE_URL` for application queries,
Drizzle Kit, startup migrations, operator scripts, and test reset. Local
development uses the Compose `postgres` account. A separate runtime role can
be introduced with the production hardening work when its operational cost is
justified.

Migration history is disposable until real financial data exists. The current
schema has one generated baseline. After pilot data exists, migrations become
append-only and schema changes use `bun run db:generate`.

The web app loads the pinned React Scan 0.5.7 browser build before hydration
from the development-only root document branch. The script has a fixed SRI hash.
Its toolbar, FPS display, and notification count stay enabled for local
diagnosis. `vite build` removes the branch, so production builds do not emit the
scanner.
React Scan adds development overhead. Use its render counts to compare identical
interactions. Do not report its instrumented durations as production latency.

## Development URLs

Development runs behind [portless](https://github.com/vercel-labs/portless), so
apps have stable named HTTPS hosts instead of ports. Portless assigns a free
port in 4000–4999 to each development process instead of its local default.
Docker image ports are a separate production concern.

| App             | URL                            |
| --------------- | ------------------------------ |
| `apps/web`      | `https://accly.localhost`      |
| `apps/server`   | `https://api.accly.localhost`  |
| `apps/fumadocs` | `https://docs.accly.localhost` |

These are the primary checkout's development hostnames only. Production ports
are fixed and listed in [Operations](./operations.md#deployment-topology).

### The dev port block

Every port this project binds locally lives in one contiguous block, so a
checkout of a different product can run at the same time without either side
moving. Nothing here uses a framework default (3000, 3001, 4321), and nothing
collides with a system Postgres on 5432.

| Port    | Bound by     | Declared in                           |
| ------- | ------------ | ------------------------------------- |
| `55442` | Postgres     | `packages/db/docker-compose.dev.yaml` |
| `55443` | API (Hono)   | `apps/server/src/index.ts`            |
| `55444` | Web (Vite)   | `apps/web/vite.config.ts`             |
| `55445` | Docs (Astro) | `apps/fumadocs/astro.config.mjs`      |
| `55451` | SeaweedFS S3 | `packages/db/docker-compose.dev.yaml` |

Vite runs with `strictPort`, so a taken 55444 fails loudly rather than sliding
onto a neighbour's port. The Docker Compose project is named `accly-db-dev`, so
its containers and volumes are namespaced away from any other checkout's.

Moving the block means editing all five declarations above plus
`s3.allowedOrigins` in the compose file (it lists the web origin explicitly) and
the `PORTLESS=0` fallbacks in `packages/env/.env.example`.

Portless prefixes these names in a linked Git worktree. Accly Books does not discover
that prefix at runtime: that worktree must set matching prefixed values for
`BETTER_AUTH_URL`, `CORS_ORIGIN`, and `VITE_SERVER_URL`. Its auth cookie still
uses the shared `.accly.localhost` parent domain, and the default database and
object store are shared too. Direct browser file transfer has one extra boundary:
the local SeaweedFS service allows only exact web origins. Add the prefixed web
origin reported by Portless to `s3.allowedOrigins` in
`packages/db/docker-compose.dev.yaml` and rerun `bun run db:up`, or point the
worktree at separately configured storage. Do not replace the allow-list with a
wildcard. A second checkout is therefore not an isolated Accly Books environment merely
because its ports do not collide; use a separate browser profile and explicit
service configuration when running one.

Each app's `dev` script is `portless`; the real command lives in `dev:app`, and
the `"portless"` key in its `package.json` maps the name to it. Turbo needs no
change — it still runs `dev` per package.

Browser auth and RPC requests go directly to the API host. The shared
`BETTER_AUTH_COOKIE_DOMAIN=.accly.localhost` is required so the session cookie
issued there also reaches the web host during SSR and a hard refresh. Without
it browser-side API calls may remain authenticated while a server-rendered page
load appears anonymous.

`bunx portless --help` covers the rest: running the proxy at boot, listing
routes, and diagnosing CA or DNS problems.

To bypass the proxy entirely, set `PORTLESS=0` — each app then runs on its own
port from the block above (web 55444, API 55443, docs 55445). Point `BETTER_AUTH_URL`,
`CORS_ORIGIN`, and `VITE_SERVER_URL` at `http://localhost:...` and remove
`BETTER_AUTH_COOKIE_DOMAIN` first, because a `.accly.localhost` cookie does not
belong on `localhost`.

Public sign-up is closed. Invitees create their account from the invitation
link, which the admin copies from the Members page and shares (nothing is
emailed). Operator scripts remain for founders and non-invited accounts:

```sh
bun run create-founder <name> <password>
bun run create-user <email> <name> <password>
bun run db:seed
```

`bun scripts/seed-demo.ts` adds screenshot data to the seeded Meridian Traders
organization. It uses the app counters for customer codes, invoices, and
receipts. Cleanup and inserts commit in one transaction, scoped to that
organization. A rerun advances counters; a reference from manually created
data causes the transaction to fail without partial cleanup.

Only `FOUNDING_EMAIL` may create Organizations through `organization.create`.
The route and trusted seed/test callers share the atomic bootstrap in
`packages/api/src/core/organizations.ts`; native Better Auth creation is closed.
One `organization_settings` row owns legal identity, financial-year fields,
time zone, currency, and document prefixes. `organization.getProfile` reads the
legal profile from that row; Better Auth owns the separate `organization` table. Other accounts receive
membership through invitation or an operator-managed membership.

## Repository map

| Path               | Purpose                                               |
| ------------------ | ----------------------------------------------------- |
| `apps/web`         | TanStack Start UI and SSR runtime                     |
| `apps/server`      | Hono host for auth, oRPC/OpenAPI, health, and logging |
| `apps/fumadocs`    | End-user product documentation                        |
| `packages/api`     | Domain routers, guards, transactions, and audit       |
| `packages/auth`    | Better Auth configuration, manual users, access model |
| `packages/db`      | Drizzle schema, migrations, database client           |
| `packages/storage` | Private S3/SeaweedFS presigning                       |
| `packages/env`     | Runtime environment loading and validation            |
| `packages/ui`      | Shared Base UI/shadcn components                      |
| `tests`            | Unit, integration, and isolated resilience tests      |

## Commands

| Command                      | Purpose                                                              |
| ---------------------------- | -------------------------------------------------------------------- |
| `bun run dev`                | Start database/storage, migrate, and run all apps                    |
| `bun run dev:status`         | Check services, URLs, database access, and migration history         |
| `bun run check-types`        | Typecheck TypeScript packages and `tests/`                           |
| `bun run check`              | Run oxlint and oxfmt (writes formatting)                             |
| `bun run test`               | Run real-Postgres integration and isolated tests; wipes `accly_test` |
| `bun run build`              | Build all workspaces                                                 |
| `bun run db:up`              | Start local PostgreSQL and SeaweedFS                                 |
| `bun run db:generate`        | Generate a Drizzle migration from the current schema                 |
| `bun run db:migrate`         | Apply migrations through `DATABASE_URL`                              |
| `bun run db:seed -- --reset` | Reset and seed development data                                      |
| `bun run db:studio`          | Open Drizzle Studio                                                  |

`dev:status` is read-only and uses three-second timeouts. It checks the Compose
service health and published ports, the configured web and API origins, the
primary checkout's fixed `https://docs.accly.localhost` URL, a `select 1`
through `DATABASE_URL`, and an exact match between local Drizzle migrations and
the recorded migration history. The command
does not start or stop services, apply migrations, seed data, or reset data. A
missing service, an unreachable URL or credential, or migration history that
cannot be verified returns a nonzero exit code. The HTTP probes do not exercise
interactive UI, and migration record agreement does not detect manual schema
drift. Linked worktrees with prefixed Portless hosts must interpret the fixed
docs URL result separately.

Use `bun run check-types`, `bun run check`, and `bun run test` as the
repository-wide integration gates. A focused change runs the smallest existing
checks that cover it; a documentation-only change runs
`bunx oxfmt --check <changed Markdown files>`. Run
`bun run --cwd apps/fumadocs build` when end-user content changes. Run a
production web build and visual inspection for SSR/UI changes.

## Dependency updates

The committed `bun.lock` makes installs reproducible; exact application-library
versions are not used as a second lockfile. Shared runtime versions live in the
root item and otherwise stay in the package that imports them. Use a normal
SemVer range unless an upstream package requires an exact matching peer. The
current exception is the matched `@fumadocs/base-ui` / `fumadocs-core` pair.

`packageManager` remains exact because Bun is the repository's runtime, package
manager, test runner, and compiler. Upgrade that toolchain pin deliberately and
change this document with it. A temporary compatibility hold must name the
incompatible peer and be removed as soon as the peer accepts the newer line; it
must not survive as an unexplained exact version or root override.

Plain `bun outdated` checks only the root workspace. Audit and update the whole
monorepo with:

```sh
bun outdated --recursive
bun update --interactive --recursive
bun outdated --recursive --force
```

Use the interactive command's latest-version toggle only after reading the
applicable migration notes. In particular, Better Auth release upgrades must be
checked for schema and account-identity migrations before changing its package
range; a passing TypeScript build cannot prove an auth database is migratable.

## Code rules

- Prefer the simplest happy path. Extract a helper at the second real call site;
  delete unused exports.
- Fail loudly on config, auth, money, and data-integrity errors. Avoid silent
  defaults and broad catches.
- Money is `bigint` paise from the database to the screen; legacy outpatient
  procedures keep decimal strings until accounting-core slice 7
  ([call 2](./specs/accounting-core.md)). Divide only with `divideHalfUp`.
  Format with `formatMoney` for display and `formatDecimal` for plain text.
  The 13-digit limit applies to form/API input only. `parseMoney` also accepts
  larger calculated totals without converting through a JavaScript number.
- Postgres `sum()` returns `numeric`, and `db.execute` returns `int8` as a
  string. Cast to `bigint` in SQL and read the value with `BigInt(...)`;
  `sql<bigint>` only labels the type.
- `JSON.stringify` throws on `bigint`, so audit metadata holds `formatDecimal`
  text and query inputs hold typed text. Amounts become numbers only in the
  XLSX writer and in chart scales; React's development build stringifies a
  changed `bigint[]` prop and throws.
- Use named function declarations for reusable functions and arrows for
  callbacks. Prefer named exports, `type` aliases, and `satisfies` for contracts.
- Use `null` for explicit absence in state/API results and `undefined` for
  omitted optional fields; do not mix them in one contract.
- Comment why the obvious approach is wrong, not what the next line does.
- Use `@accly/ui` primitives for shared controls. Feature layout stays near the
  route; shared visual contracts stay in `packages/ui`.
- Use keyset pagination and tenant-leading indexes. Scope writes with one
  `UPDATE/DELETE ... RETURNING` where possible.
- Never hand-edit generated migrations or `apps/web/src/routeTree.gen.ts`.
  Hand-authored SQL lives in its own migration file.
- Migration history is append-only once any environment retains data. Before
  then a baseline squash is allowed; recreate any pre-existing local database
  with `bun run db:seed -- --reset` after one.

- No secret or server-only value import may reach client assets.

### React and forms

React Compiler is enabled for the web app. Keep transient search, tab, and form
state in the smallest subtree that renders it; extract the owner boundary before
adding manual `memo` or `useMemo`, and let each one that survives cite the
measurement that justified it.

Each rule below answers one question, so the shape of a screen is decided rather
than chosen. Anything not on a list here is not a third option — it is a
divergence, and it needs a reason in the diff.

#### Who owns the value

| Value                                            | Owner                                            |
| ------------------------------------------------ | ------------------------------------------------ |
| A native input's draft, until submit             | the DOM, via `RegisteredFormField`               |
| A widget's value, or one that changes at runtime | RHF, via `FormField` (a `Controller`)            |
| Anything the server returns                      | TanStack Query — never copied into `useState`    |
| A committed, shareable search or open tab        | route search params, via `validateSearch`        |
| Ephemeral text, hover, which row is open         | `useState` in the smallest child that renders it |

Nothing persists to `localStorage` or `sessionStorage`. If a draft ever must
survive a reload, add one keyed helper beside `use-zod-form.ts` rather than a
storage call inside a component.

#### Forms

Every form starts at `useZodForm(schema)`; no route calls `useForm` directly.
Native inputs hand back strings, so the schema does the coercion through the
`lib/form-schema.ts` helpers — no `valueAsNumber`, no parsing in the submit
handler. Money fields are the exception: they stay rupee text, the schema checks
them with `NON_NEGATIVE_MONEY_PATTERN`, a comparison parses them with
`parseMoneyInput`, and the procedure's `money` input fragment parses them once.

RHF subscriptions stay as narrow as the rendered dependency: dynamic lists use
`useFieldArray`, conditional fragments use `Watch`, and field state uses exact
names. A root `watch()` is reserved for screens whose whole render genuinely
depends on the watched value. The shared field wrapper owns one field-state
subscription, and form-wide dirty/error state is rendered by the smallest leaf
that needs it.

A failed submit belongs to a field when the server named one: call
`applyOrpcFieldError` first, and toast only what no field owns.

#### Reading data

One question decides the shape: **can the page render without this?**

| Answer                      | Loader                                 | Component          | Failure surfaces as                |
| --------------------------- | -------------------------------------- | ------------------ | ---------------------------------- |
| No — it _is_ the page       | `loadRouteQuery(queryClient.query(…))` | `useSuspenseQuery` | the route error boundary, or a 404 |
| Yes — a panel, card, or tab | `queryClient.query(…).catch(() => {})` | `useQuery`         | an `ErrorNote` in place            |

Apply it per query, not per route: a route may legitimately require one and
treat three others as optional — the dashboard does. What a route must not do is
load the same procedure both ways.

Live operational lists add `OPERATIONAL_REFETCH`, or
`OPERATIONAL_INFINITE_REFETCH` when paged. Membership is read only through
`useMembership`: the `/$orgSlug` loader has already awaited it, so a `useQuery`
beside it adds pending and error branches that cannot run. Currency and time
zone come from membership too — `settings.get` is for the settings editor and
for fields only it has, because reading it needs a `settings:read` grant that a
cashier does not have.

A read that failed renders `<ErrorNote error={…} />` and lets `ErrorNote` word
it. A mutation that failed toasts `errorMessage(error, "Could not …")`. Neither
prints `error.message` raw: a dropped connection has no sentence of its own, and
"Failed to fetch" is not one an operator can act on.

Writes invalidate through the shared helpers in `lib/domain-invalidation.ts`, so
one transition touches the same key set wherever it is triggered.

Remote type-ahead keeps raw text in the smallest child and debounces before the
query key; the server matches and bounds the results. Local filtering is for a
complete, bounded, already-loaded list.

UI implementation follows [Design](./design.md): `text-xs` body, compact
controls, token colors/radii, stable focus visibility, and rationed motion.

## Tests

Pure no-I/O logic belongs in `tests/unit`. Anything touching a router, auth, or
the database belongs in `tests/integration` and uses real PostgreSQL through
`clientFor`.

- Prefer one end-to-end workflow test with meaningful assertions over many
  micro-tests.
- Keep top-level `test(...)`; avoid nested `describe` and shared mutable setup.
- Use factories that return ready-to-use users/Organizations; tests mint unique
  identities because the database is shared within a file.
- Assert oRPC codes, invariants, and state—not message copy or properties already
  guaranteed by types.
- Use `eventually`/`drainAuditWrites()` for fire-and-forget audit behavior; do
  not sleep.

Every org-scoped domain extends `GUARDED_CALLS` in
`tests/integration/tenancy.test.ts`, whose sweeps prove missing claim, foreign
claim, and immediate revocation. The domain test must additionally prove its
own rows are invisible across tenants.

## Documentation

The [documentation index](./README.md) defines ownership. Current behavior stays
in living docs. Do not add a Markdown file when a section in an existing owner is
enough.

When a repeated mistake appears, promote guidance from doc → test → type → lint
or structure → script. `AGENTS.md` remains short: map plus rules that must be
seen before any change.
