# ADR 0001: Documents first, ledger derived and append-only

Date: 2026-09-08
Status: accepted

## Context

The accounting core must be keyboard-fast, audit-grade, able to absorb Indian tax rule changes as data, migrate many times over years, feed AI agents, and later run from an offline client. Three shapes were compared against Frappe Books, ERPNext, Odoo, Zoho Books, Tally, Xero, QuickBooks, TigerBeetle, Formance, pgledger, Modern Treasury, Square Books and River (see `docs/research/ledger-architecture.md`): a ledger-first voucher system, a documents-first system with a derived ledger, and an event-sourced ledger with projections.

## Decision

Documents are the only write model. Posting derives journal entries and lines, party ledger lines and balances in the same Postgres transaction. Posted rows change only through the posting and reversal procedures. `recordEntry` refuses an unbalanced entry before insert, and no code path updates or deletes a posted row (amended 2026-09-13: the database triggers were dropped while the application is the only writer). Corrections are reversing entries. Money is `bigint` paise. Tax and posting rules are dated data rows that documents reference. The pre-production MVP uses one database credential. RLS, a restricted runtime role, and idempotent command ingestion are deferred.

## Consequences

- The ledger is trustworthy by construction and reports are reproducible, matching what every mature system converged on.
- Offline sync later defines its replay contract, idempotency keys, and any location-specific number series; no projection rebuild machinery is needed now.
- A backdated document before a lock updates later balances synchronously; after a lock it is refused unless an exception exists. There is no queued reposting.
- Event sourcing's replayable history is given up; documents and reversing entries carry the accounting story. A hash chain can be added later without changing the model.
- Any future feature that wants to edit a posted row must instead add a document type or a reversal; this is deliberate.
