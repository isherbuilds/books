# Operations

## Environment

`packages/env` validates at import. Local runs read `packages/env/.env`, process
variables win, and images carry no `.env`. Both containers get the server
variables, because web SSR imports auth and database code.

- `DATABASE_URL`: PostgreSQL. Tests need a `_test` database.
- `BETTER_AUTH_SECRET`: at least 32 characters, the same on server and web.
- `BETTER_AUTH_URL` and `VITE_SERVER_URL`: the public API origin.
- `CORS_ORIGIN`: the exact web origin and the invitation-link base.
- `BETTER_AUTH_COOKIE_DOMAIN`: the shared parent domain, so web SSR gets the API
  cookie.
- `FOUNDING_EMAIL`: the only account that creates Organizations.
- `VITE_WEB_URL`: the bare web origin for canonical, sitemap and OG URLs.
  `VITE_WHATSAPP_NUMBER` and `VITE_CONTACT_EMAIL`: public contacts (E.164
  digits).
- `SEAWEEDFS_ENDPOINT`, `_BUCKET`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`: all
  or none; a partial group fails at startup. Without them, uploads and read URLs
  fail with a named error.
  `SEAWEEDFS_MAX_UPLOAD_BYTES` defaults to 100 MiB and is checked first.
- `SKIP_ENV_VALIDATION`: build only.

A new variable goes into the narrowest Zod schema, the example file and the
deployment config. It is optional only if its feature fails with a named error.
Search `.output/public` of a production build for server imports and real
secret values, not names.

## Deployment topology

`apps/web` (Nitro) listens on 3001 and `apps/server` on 3000. Both are public,
and the browser calls the API directly. PostgreSQL is private. The SeaweedFS S3
gateway is public for signed requests; the bucket is private. Each Dockerfile
sets `PORT`; never rely on the development fallback. Portless and Compose are
development-only. The server migrates before it serves: a failure stops
startup, and concurrent starters wait on the advisory lock. A rolling release
needs migrations that the old version tolerates. Destructive changes use
expand-and-contract.

## Production hardening

- A stored role outside `owner`, `accountant`, `ca` and `operator` (Better
  Auth's `member` and `admin` included) fails closed. Reset pre-pilot databases
  before you deploy.
- Both hosts send `nosniff`, a referrer policy, and a permissions policy that
  denies camera, microphone, geolocation and payment, plus HSTS in production.
  API CSP: `default-src 'none'; frame-ancestors 'none'`. Web CSP: self, its API
  and storage origins; only the same origin may frame web pages. Scripts allow
  `'unsafe-inline'`, because TanStack Start emits an inline hydration script
  and offers no nonce.
- CORS is credentialed for `CORS_ORIGIN` only. Cookies are HTTP-only, secure and
  SameSite Lax.
- Runtime images hold production dependencies only and run as `bun`.
- `bun run cleanup-uploads --older-than-hours 24 [--delete]` reports stale
  uploads and orphaned objects. It is a dry run without `--delete`.

This work closes when release evidence records image digests, sizes, startup
health, headers on both hosts and a reviewed cleanup dry run.

## Release verification

1. Record the commit. Run type checks, lint, tests and a production build.
2. Start both images. Check health, sign-in and a hard refresh of an org URL.
3. Inspect SSR HTML for failure markers, and client assets for secrets and
   server code. For public-site changes: no changelog bodies in the main
   bundle, one hero image per theme, and keyboard access to the changelog and
   the Product menu.
4. Switch organizations, run a guarded mutation, and confirm cross-tenant
   denial.
5. Upload and read a private file.
6. Print on a real A4 printer before cutover.

## Pilot readiness

One named pilot owner records every gate before the first live shift. Evidence
goes with the release. A configuration or workflow change reruns only its gate.

1. Staff have used the shipped exports (day book, TDS register) on
   representative data, or a time-boxed manual procedure with an owner covers
   the gap.
2. Every account has the least role it needs, and the role map is walked with
   the pilot owner.
3. Organization, bank account, payment method, time zone and prefix settings
   match real records.
4. The CA has approved classifications, printed fields, the chart templates,
   the call 16 receipt table and the TDS seed. Printers have produced every
   document type.
5. Staff have rehearsed every live workflow, including cancellations.
6. A joint PostgreSQL and object-storage restore is timed and verified, with
   cutover and rollback owners.
7. Advisers have recorded the GST, DPDP, retention and other duties, each with
   an owner and evidence.

## Accounts and Organizations

Run `create-founder` once. The founder creates Organizations at `/create`, and
staff join from an invitation link at `/join`. No email is sent. The link
creates the invited account, so hand it over directly, treat it like a
temporary password, and cancel it if it leaks. There is no password reset yet.

## Backups and restore

Back up PostgreSQL and object storage together, off-host; either one alone
loses files or authorization. Before go-live and after any data-rewriting
migration, restore both into an isolated environment. Sign in, open a record,
download a file, run the day book export, and record the date, duration and
failures.
