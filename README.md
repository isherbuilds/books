# Accly Books

A multi-tenant accounting and billing system: customers, items, invoices,
payments and a double-entry ledger. It is a Bun/Turborepo monorepo with TanStack
Start, Hono/oRPC, Drizzle/PostgreSQL, Better Auth, and private S3-compatible
storage.

## Start locally

Prerequisites are Bun (the version pinned in `package.json`), Node 24, and
Docker.

```sh
bun install
cp packages/env/.env.example packages/env/.env
# Once per machine, start the named local HTTPS proxy:
bunx portless proxy start
# Fill in the environment file, then start the stack:
bun run dev
```

The root command starts PostgreSQL and SeaweedFS, applies migrations, and runs
the web app, API, and end-user docs at `https://accly.localhost`,
`https://api.accly.localhost`, and `https://docs.accly.localhost`. See
[Development](docs/development.md) for accounts, worktrees, proxy bypass, and
the canonical command list.

## Documentation

Start at the [documentation index](docs/README.md) for the source-of-truth map
and current work registry. Contributor and agent rules are in
[AGENTS.md](AGENTS.md); end-user help lives in `apps/fumadocs`.

## License

Accly Books is licensed under the GNU Affero General Public License, version 3
only. See [LICENSE](LICENSE). Copyright (C) 2026 Accly. Anyone who runs a
modified version as a network service must offer its source to the users of
that service. Third-party code copied into this repository keeps its own
copyright notice at the top of the file and is listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
