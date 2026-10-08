# Codebase map

Orientation for `spec` and `implement`. Owners hold the detail: [Architecture](../architecture.md), [Development](../development.md), [Accounting core](../specs/accounting-core.md).

| Path | Role |
| --- | --- |
| `apps/web` | TanStack Start UI. Org pages under `src/routes/$orgSlug/`; PDF endpoints as `src/routes/api.$orgSlug.*.pdf.ts`; public pages under `_site`. |
| `apps/server` | Hono host for the oRPC API at `/rpc`. |
| `apps/docs` | Docs site served at `/docs`. |
| `packages/api` | `routers/*` are thin oRPC procedures built on `orgProcedure`. `core/*` holds the logic: `posting.ts` (one posting function per Document), `money.ts`, `numbering.ts`, `locks.ts`, `reports.ts`, tax schedules. `lib/*` holds schemas and import. |
| `packages/auth` | Better Auth, organization plugin; `access.ts` is the only permission and role owner. |
| `packages/db` | Drizzle schema, generated baseline migrations, `runMigrations`. |
| `packages/storage` | Private objects, presigned URLs only. |
| `packages/ui` | shadcn `base-lyra` on Base UI. |
| `packages/env`, `packages/config` | Environment parsing and shared config. |
| `tools/oxlint` | `anti-slop/` (vendored) and `accly/` (project rules). |
| `tests/{unit,integration,isolated}` | Pure logic; router/auth/database on real PostgreSQL (`accly_test`). |

## Seams in use

- Every org procedure takes `orgSlug`; `orgProcedure(permission, input)` produces `context.scope`.
- Documents post through `core/posting.ts`; the journal is append-only.
- `tests/integration/tenancy.test.ts` `GUARDED_CALLS` proves tenant isolation per domain.

## Test prior art

Workflow tests over micro-tests, `clientFor` for real oRPC calls, `eventually` and `drainAuditWrites()` instead of sleeps.
