# Accly Books documentation

These pages are the repository's living sources of truth. Keep a fact in one
place and link to it elsewhere.

| Document                          | Owns                                                                 |
| --------------------------------- | -------------------------------------------------------------------- |
| [Product](./product.md)           | Scope, vocabulary, roadmap gates, and product invariants             |
| [Architecture](./architecture.md) | Runtime shape, tenancy, authorization, data, storage, and accounting |
| [Development](./development.md)   | Local setup, code style, tests, and contribution rules               |
| [Operations](./operations.md)     | Environment, deployment, backups, and release checks                 |
| [Design](./design.md)             | UI tokens, density, layout, motion, and completion checklist         |

## Work lifecycle

This is the sole registry for unfinished documentation-backed work. Each linked
file owns its contract; lifecycle is recorded only here. **Active** means
implementation remains, **Blocked** means a named prerequisite prevents
progress, and **Verification** means implementation is complete but its exit
evidence is not. Product roadmap items remain evidence-gated — not active work —
until their trigger is met and they enter this registry.

| Work                                                                        | Lifecycle    | Exit condition                                                                                                                                                             |
| --------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Accounting core](./specs/accounting-core.md)                               | Active       | CA advance-account decision recorded per spec; all seven slices verified; the legacy outpatient, charge and customer domain is deleted and the docs describe the new core  |
| [Organization settings consolidation](./specs/accounting-core.md#task-plan) | Verification | Restore development services and credentials, recreate the disposable local database for the new baseline, and verify creation and settings save/reload in the running app |
| [Client patterns](./specs/client-patterns.md)                               | Active       | Five slices verified; the H4 runs for receipts and invoices are within 10 percent of TallyPrime and recorded in the spec                                                   |
| Midday commercial licence                                                   | Blocked      | Blocked on a reply from Midday Labs; a written commercial licence is on file before the first external release                                                             |
| Retire the legacy outpatient module                                         | Blocked      | Blocked on accounting core slice 7; then `opd_appointments`, `practitioners`, `departments` and the OPD register report go                                                 |
| Marketing captures                                                          | Active       | The `/customers` and `/billing` pages carry captures of the accounting screens, not the outpatient ones                                                                    |
| [Production hardening](./operations.md#production-hardening)                | Verification | Release-time evidence on the deployed host records digests, sizes, header checks, and a reviewed cleanup dry run                                                           |
| [Pilot readiness](./operations.md#pilot-readiness)                          | Active       | A named owner records every operational, accounting, print, restore, and compliance gate complete                                                                          |
| [Blank data regions](./design.md#9-density-and-emptiness)                   | Verification | Slow-4G cold-open and screen-reader checks confirm no collapsed region and no ambiguous silent navigation                                                                  |

End-user help belongs in `apps/fumadocs`, not here. Code is authoritative for
exact APIs, schemas, permissions, and environment validation; these docs explain
the stable shape and why it exists.

## Documentation rules

- Write current behavior in present tense. Git is the changelog.
- Update the closest source of truth in the same change as behavior. Delete
  stale text instead of adding a correction beside it.
- Prefer links to repeated rules. `AGENTS.md` stays a map plus hard invariants.
