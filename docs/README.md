# Accly Books documentation

Each page owns one area. Keep a fact in one place and link to it. Code is the
authority for exact APIs, schemas and permissions. End-user help lives in
`apps/fumadocs`; terms live in [`CONTEXT.md`](../CONTEXT.md).

| Page                                           | Owns                                 |
| ---------------------------------------------- | ------------------------------------ |
| [Product](./product.md)                        | Position, scope, language, gates     |
| [Architecture](./architecture.md)              | Tenancy, data, audit, files, ledger  |
| [Development](./development.md)                | Setup, commands, code rules, tests   |
| [Operations](./operations.md)                  | Environment, deployment, pilot       |
| [Design](./design.md)                          | The UI source of truth               |
| [Accounting core](./specs/accounting-core.md)  | The accounting contract              |
| [Client patterns](./specs/client-patterns.md)  | Palette, forms, lists, Sheets        |
| [CA interviews](./validation/ca-interviews.md) | The pre-launch CA interview protocol |

## Work lifecycle

The only list of unfinished work. **Active**: work remains. **Blocked**: a named
prerequisite stops it. **Verification**: the code is done; the evidence is not.
Check UI items in the running app on desktop and mobile, in both themes.

- **[Accounting core](./specs/accounting-core.md)**: Active. Slices 4b-ii and
  5–7, plus CA acceptance and the native PostgreSQL posting baseline for slices
  1–3. Slices 4a and 4b-i are implemented and verified in the running app on
  desktop and mobile, in both themes.
- **Settlement reads at volume**: Verification. Invoice open and overdue filters
  and `receipt.unapplied` join one grouped active-allocation total. Measure them
  on 100,000 Invoices with allocations before adding any stored balance.
- **Client patterns**: Active. Slice 3 row focus and volume checks, a 5,000-row
  sort measurement, the H4 runs, and slice 5. Slice 4 is implemented and runtime
  verified with accounting-core slices 4a and 4b-i.
- **Organization settings**: Verification. After `bun run db:seed -- --reset`
  (it deletes local data), create an organization, then save and reload its
  settings, including the Payment prefix.
- **Banks settings**: Verification. On the reset database, add a cash account and
  a bank account from the Add account Sheet, add a method from the Add method
  Sheet that lands in the new bank account, then archive and restore it. Post a
  receipt with that method and confirm the balance moves; cancel it and confirm
  the balance returns. Sign in as a CA and confirm that the page shows accounts,
  balances and methods without the add and archive actions.
- **Receipt "Advance for" field**: Verification. A goods advance posts; a
  taxable service advance shows the field error.
- **Blank data regions**: Verification. A slow-4G cold open and a screen-reader
  pass.
- **Production hardening**: Verification.
  [Release evidence](./operations.md#production-hardening).
- **Pilot readiness**: Active. A named owner records every
  [gate](./operations.md#pilot-readiness).
- **Marketing captures**: Active. The public `/billing` and `/customers` pages
  and the landing copy still describe the deleted outpatient module.
- **Midday licence**: Blocked on Midday Labs. A written licence comes before the
  first external release.

## Rules

- Write in the present tense, in short sentences. No changelogs, dated status or
  benchmark logs: Git is the changelog.
- Change the owning page with the behaviour. Delete stale text.
- Add a page only when no owner fits. Research is evidence: fold each decision
  into its owner as one line.
