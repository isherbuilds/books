# Ledger architecture: what the incumbents do, and what to build

Date: 2026-09-08. Method: three research agents read the open-source code (Frappe Books, ERPNext plus india-compliance, Odoo), the closed products' docs and demo (Zoho Books, TallyPrime, Xero, QuickBooks Online), and the modern ledger engines and sync tools (TigerBeetle, Formance, pgledger, Modern Treasury, Square Books, River, Replicache, ElectricSQL, PowerSync). I read the current repo's ledger myself. Every claim carries a source; inferences are marked.

## 1. The answer in short

No incumbent is a design to copy whole. Every serious system, open or closed, converges on the same shape, and the differences between them are in how strictly they enforce it:

1. Documents are the write model. They are mutable while draft and frozen once posted (Odoo `state`, ERPNext `docstatus`, Zoho draft to published, Pennylane draft to finalized, Modern Treasury pending to posted).
2. The ledger is derived from documents inside the same transaction and is never a write target of its own (Xero `/Journals` is read-only and every line carries `SourceType` and `SourceID`; Odoo's move lines are the ledger; ERPNext generates GL Entry from the document).
3. Posted ledger lines are append-only. Corrections are new reversing lines, never edits (ERPNext immutable-ledger mode, Odoo `_reverse_moves`, Square Books with no UPDATE statements at all, Beancount, Kleppmann).
4. Balances are materialized, not summed on read (Square, pgledger, River at p95 10 ms, Modern Treasury's three balances).
5. Tax rates and rules are dated data rows that are archived forward, never mutated; a document snapshots the version that applied (Stripe Tax, Avalara, ERPNext Tax Rule with from and to dates, India's full rate-schedule replacement on 22 Sept 2025).
6. Compliance is layered on the core through hooks and versioned patches, not baked into posting (india-compliance on ERPNext, Odoo `l10n_in`).
7. Period locks exist, and the good ones have scoped, audited exceptions (Zoho) rather than a global switch (Xero).
8. Reports are a small formula language over account codes and tags (Odoo `account_report`), not one hand-written class per statement (Frappe Books, ERPNext).
9. AI never writes to the ledger directly; it reads a curated model and proposes through a narrow tool schema with human approval (Pennylane, Puzzle, Digits).

The best long-term design for this product is that shape, built natively on Postgres and TypeScript, with two additions the incumbents lack: a command log so offline sync is possible later, and per-site document number series so an offline device can finalize legally. Of the three options discussed in the brainstorm, that is option 2 (documents first, ledger derived) with the enforcement of option 3 (append-only, commands logged) and none of its cost (no async projections, no event store).

The current repo is already option 2 in its simplest form: documents post balanced journals in one transaction with a unique source key. It lacks reversal, period lock, party sub-ledger, materialized balances, dated tax rules, a posting-rule table and a command log, and its accounts are hospital-shaped. The spine is worth keeping; the ledger needs the additions in section 6.

## 2. Product-by-product

### Frappe Books (GPL-3, Vue, Electron, SQLite)

How it works: `AccountingLedgerEntry` rows per account leg, written one INSERT at a time by a `LedgerPosting` object that checks debits equal credits before posting; `Transactional` base class posts on submit, reverses on cancel, and hard-deletes ledger rows on delete. Tax is a template of rate rows. Reports are hand-written TypeScript classes. Migrations are an ordered list of manual patch functions over SQLite. Sources: `schemas/app/AccountingLedgerEntry.json`, `models/Transactional/LedgerPosting.ts`, `backend/patches/index.ts`.

Pros: simplest readable double-entry core; reversal-by-insertion with `reverted` and `reverts` links; offline by construction; tax as data.
Cons: no period lock at all; hard delete of ledger rows on document delete; single tenant; no API; row-by-row posting; report classes do not survive chart changes; sync to ERPNext exists only as a queue schema.
Verdict: a readable reference for the posting primitive and nothing else. Its offline story is "there is no server", which is not the offline story this product needs.

### ERPNext accounts plus india-compliance (GPL-3, Python, MariaDB first)

How it works: one flat `GL Entry` table with per-currency amount quadruples, party, voucher and against-voucher links, cost centre, finance book, `is_cancelled`. A second `Payment Ledger Entry` table exists only so receivable and payable matching never scans GL Entry. `make_gl_entries` validates budget and period, distributes by cost centre, merges similar lines, mirrors to the payment ledger, then bulk-inserts. Two correction modes: legacy updates `is_cancelled` on old rows; immutable-ledger mode inserts reversing rows dated at cancellation and touches nothing. `Accounting Period` and `Period Closing Voucher` enforce locks with an exempted role. `Tax Rule` is a priority-ordered filter table with from and to dates that selects a tax template. india-compliance is a separate app attached through `doc_events` hooks, custom fields, versioned patches and a scheduler that retries e-invoice and e-way-bill calls every five minutes. Sources: `erpnext/accounts/general_ledger.py` lines 607 to 724, `payment_ledger_entry.json`, `tax_rule.json`, `india_compliance/hooks.py`, `india_compliance/patches.txt`.

Pros: the most complete reference for Indian compliance layering; payment ledger split; dated tax-rule selection; period closing with exemptions; immutable mode proves the append-only path works at scale.
Cons: the flat GL table is the known bottleneck; backdated stock entries trigger `Repost Item Valuation`, a queue-driven full recomputation; Postgres support is retrofitted with visible shims; every rule change ships as a patch tied to a release train; no offline.
Verdict: copy the compliance layering and the payment-ledger split. Do not copy the flat GL table without partitioning or the legacy mutation path.

### Odoo `account` (LGPL-3 community, Python, Postgres)

How it works: a single `account.move` header for every document type and a single `account.move.line` table that is the ledger; state draft, posted, cancel; `parent_state` denormalized onto every line so reports never join; posting assigns the sequence and freezes; corrections dispatch by provenance in `_unlink_or_reverse` (delete if nothing depends on it and no hash or lock applies, cancel in place if audit-protected, otherwise reverse); a rolling hash chain per journal (`inalterable_hash`, `secure_sequence_number`) with a write guard that raises on any hashed field; separate general and tax lock dates; taxes as data with a Python computation engine; reports as a formula language over account codes and tags. Sources: `addons/account/models/account_move.py` lines 354, 3930, 4599 to 4700, 5502, 5545; `account_move_line.py` line 69; `account_report.py`.

Pros: strongest immutability model in the set; explicit correction dispatch; two lock dates; report DSL; Postgres native.
Cons: `account.move.line` is the largest and most contended table in real deployments; major-version upgrades need a paid service or OpenUpgrade because the ORM only auto-migrates field drift; Indian e-invoicing lives in paid Enterprise modules; no offline.
Verdict: the best single design reference for the core. Borrow the state machine, the hash chain, the correction dispatch, the lock dates and the report DSL.

### Zoho Books (closed, cloud)

How it works: REST v3 with `organization_id` on every call, eight regional datacentres, per-org rate limits. Journals have draft and published states with explicit action endpoints for transitions; invoices likewise (`/status/void`, `/status/sent`, approve and reject). Transaction locking is org-wide by date with scope levels and per-user or per-account exceptions that require a reason and record who locked. Audit trail is field-level version diffing, admin-only, and region-gated. Webhooks with HMAC secrets and visible retries. Zoho is itself a GSP; IMS is a two-way state machine per supplier document with a hard GSTR-3B cutoff. Sources: `zoho.com/books/api/v3/journals`, `/transaction-locking`, `/invoices`, `zoho.com/in/books/help/gst/ims.html`.

Demo finding: the public demo makes zero backend calls. It ships a 330 KB cached JavaScript model bundle and renders lists, detail and trial balance client-side. It proves nothing about Zoho's servers, and it proves that computing reports from a local dataset is instant.

Pros: transitions as actions, scoped lock exceptions, field-diff audit trail, IMS state machine, GSP built in.
Cons: audit trail is not universal; reports API is undocumented; per-org subscriptions with no owner view; online only.
Verdict: copy the transition-as-action API shape, the scoped lock, and the IMS state machine.

### TallyPrime (closed, desktop)

How it works: one local process over a proprietary file store per company, which is why it is fast (inference from architecture, no vendor performance write-up). Multi-user is a shared folder over LAN; Tally's own help pages document corruption from network blips, LAN and Wi-Fi mixing, and power loss mid-write. Corrections are edit-in-place with an Edit Log since release 6.1, added because MCA required an audit trail from 1 April 2023. Extension is TDL, an XML gateway on port 9000, or ODBC; there is no cloud API. Sources: `help.tallysolutions.com/data-migration-data-corruption-faq/`, `tallysolutions.com/tally/audit-trail-in-tallyprime/`, `help.tallysolutions.com/xml-integration/`.

Pros: keystroke speed from local data; ledger masters as a free hierarchy; vouchers as the single mental model.
Cons: shared-file concurrency corrupts data; edit-in-place with a log is weaker than append-only; no API; no cloud.
Verdict: the speed target and the anti-pattern in one product. Match its speed with local data on the client; never share a file store between writers.

### Xero and QuickBooks Online (closed, cloud)

Xero: `/Journals` is read-only and derived; every line carries `SourceType` and `SourceID`; manual entries go through `/ManualJournals`; the lock date is global and the API cannot bypass it; users have asked for years for "unlock for me only". QuickBooks: every object carries a `SyncToken` and a stale token is rejected, so there are no lost updates without locks; a Change Data Capture endpoint returns everything modified since a timestamp because polling does not scale. Sources: `developer.xero.com/documentation/api/accounting/manualjournals`, `help.xero.com/us/Settings_LockDate`, Intuit CDC and SyncToken as summarized by integration vendors (primary page not fetched).

Verdict: copy the derived-ledger rule, the version token, and the change feed. Avoid the global lock.

### Purpose-built ledgers and engines

TigerBeetle: a separate database for accounts and transfers, single-threaded by design, batches of 8,190 transfers, one million transfers a second. Overkill here: it replaces the database for the ledger slice, needs its own cluster, and gives up SQL joins that reports and agents need. Formance: Numscript DSL over Postgres with hash-chained logs; another service to run. pgledger: pure Postgres functions with ULID ids and the before and after balance stored on every entry. Modern Treasury: pending and posted balances, transactions mutable while pending with every version retained. Square Books: append-only on Spanner, corrections as offsetting entries, one materialized pending-balance row per book, 20 TB run by three engineers. River: append-only events plus one denormalized balance row with optimistic locking, p95 10 ms, p99 20 ms, and a CHECK constraint that assets equal liabilities. Sources: `docs.tigerbeetle.com/concepts/performance/`, `github.com/pgr0ss/pgledger`, `docs.moderntreasury.com/ledgers/docs/guide-to-ledger-objects`, `developer.squareup.com/blog/books-an-immutable-double-entry-accounting-database-service/`, `river.com/content/we-replaced-our-ledger-with-two-functions`.

Verdict: the pattern, not the products. Append-only entries, a materialized balance row, a constraint that enforces balance, and a narrow write API.

### Offline sync tools

Replicache and Zero: optimistic local mutations rebased on a server-authoritative log. ElectricSQL: Postgres logical replication into local SQLite through "shapes"; joined Databricks in August 2026, self-host or migrate. PowerSync: server-to-client sync that rejects CRDTs for business data and makes the backend decide conflicts. Evolu: CRDT with end-to-end encryption. None of them solve gapless document numbering or double-entry invariants; all defer conflicts to your backend. Vyapar tells users to disable multi-device sync before going offline, which shows even the market leader has no multi-writer offline story. Sources: `replicache.dev`, `docs.powersync.com/overview/powersync-philosophy`, `vyaparapp.in/videos/how-to-do-offline-billing-in-vyapar-app`, the DDD/CQRS thread on invoice numbering `groups.google.com/g/dddcqrs/c/LPBPw9JMIDI`.

Verdict: offline is a business-process design, not a library choice. A document is a local draft until it syncs, or the site owns a reserved number series. Sync a command log, not rows.

## 3. The three options, judged on the evidence

| Criterion                   | 1. Ledger first, Tally-shaped                                                                               | 2. Documents first, ledger derived                                                                                            | 3. Event ledger                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Entry speed                 | Every screen is a voucher; the accountant fills accounts by hand. Fast for experts, slow for everyone else. | Receipt, payment and invoice forms with posting rules; the user never picks accounts. Fastest for the stated audience.        | Same forms, but every write goes through an event store and a projection; speed depends on projections being synchronous. |
| Write performance           | One insert per leg, fine.                                                                                   | Document plus lines plus journal lines in one transaction, fine. River-style balance row adds one update per account touched. | Event append plus projection writes; two to three times the rows per action.                                              |
| Read and report performance | Sum over journal lines unless balances are materialized.                                                    | Same, so materialize balances and keep a party sub-ledger.                                                                    | Projections are fast if synchronous; async projections show stale balances, which users read as lost money.               |
| Scalability                 | Flat GL table, the ERPNext and Odoo bottleneck.                                                             | Same table growth; partition by org and period when large, split party ledger early.                                          | Event table grows faster than either; projections can be rebuilt, which is its real advantage.                            |
| Correction and audit        | Edit-in-place unless you forbid it.                                                                         | Draft mutable, posted immutable, reversal only. Enforce with REVOKE UPDATE on journal lines and an optional hash chain.       | Immutable by construction.                                                                                                |
| Changing compliance         | Rules live in the accountant's head.                                                                        | Posting-rule table and dated tax tables; compliance as a layer with its own tables and jobs (india-compliance pattern).       | Same tables; replays let you recompute derived reports under corrected rules, but never a filed document.                 |
| Migrations                  | Simple schema.                                                                                              | Drizzle generated migrations; documents and lines are stable shapes, rules are data.                                          | Event schemas must be versioned forever; every projection change is a replay. Heaviest.                                   |
| AI                          | Raw ledger is hard for an agent to explain.                                                                 | Documents plus a curated read model are what agents reason over; write tools are the document commands.                       | Best explainability (a full history) at the highest cost.                                                                 |
| Offline later               | Vouchers sync as rows; conflicts on balances.                                                               | Needs a command log alongside documents so clients can replay; number series per site.                                        | Native, this is what it is for.                                                                                           |
| Cost for one developer      | Low to build, high to make friendly.                                                                        | Medium.                                                                                                                       | High, and every screen waits on it.                                                                                       |

Option 2 wins on speed, migrations, AI and cost. It loses to option 3 only on offline readiness, and that gap closes by adding a command log now: every mutation is a named, idempotent command stored with its client id, device sequence and result. That is the part of event sourcing that offline sync needs; the projection machinery is the part that costs months.

## 4. Performance and scale facts to design against

- Postgres append-only inserts with a materialized balance row: p95 10 ms, p99 20 ms per balance operation, constant in account history (River).
- Single-node Postgres sustains tens of thousands of inserts a second early and thousands after a billion rows without partitioning; WAL flush on commit is the floor for durable financial writes. A school or hospital posts hundreds of documents a day, so the ledger is never the bottleneck; the client is.
- Keystroke speed is a client property: masters (parties, items, accounts) cached locally, forms that never wait on the server to render, optimistic confirmation, server round-trip only on finalize. Zoho's demo shows a whole trial balance renders instantly from local data.
- Partition journal lines by organization and financial year only when a table is large; never partition rule or master tables.
- Keep a party sub-ledger (receivable and payable lines by party and document) from day one so ageing and matching never scan the journal (ERPNext learned this late).

## 5. What the incumbents got wrong, so this product does not

- Mutating history on cancel (ERPNext legacy) and edit-in-place with a log (Tally). Append-only from day one.
- One flat ledger table with no plan for growth (ERPNext, Odoo). Plan partitioning and the party ledger before they are needed.
- Backdated entries that recompute everything in a queue (ERPNext stock). Decide now: backdating past a lock is refused; before a lock it reposts synchronously in the same transaction.
- Global lock date with no exceptions (Xero). Scoped, audited exceptions (Zoho).
- Audit trail as a regional add-on (Zoho). Universal, field-level, admin-readable.
- Compliance logic inside the posting path (Odoo Enterprise, Zoho). A separate layer with hooks, its own tables, and retrying jobs (india-compliance).
- Reports as classes (Frappe Books, ERPNext). A formula language over account codes and tags (Odoo).
- Raw API exposed to an LLM (Pennylane's reported failure mode). Narrow tools and approval gates.
- Shared file store for multiple writers (Tally). Never.

## 6. Foundations to build, in order

1. Money as `bigint` paise everywhere in storage and math; decimal strings only at the API edge. The current repo computes in paise but stores `numeric(12,2)`; switch before the first real document.
2. Documents with a state machine: draft, posted, cancelled; `version` column checked on every update (QuickBooks SyncToken); `source` and `externalRef` for documents posted from other systems; per-organization, per-financial-year, per-site number series assigned at post time.
3. Journal: `journal_entries` and `journal_lines` as today, plus `reverses` and `reversedBy` links, `postedAt`, and a Postgres role for the app with no UPDATE or DELETE on lines. Debits equal credits enforced by a deferred constraint or a trigger, not only in code.
4. Party sub-ledger: one row per receivable or payable line with party, document, amount, and settled amount; settlements append, never edit.
5. Balances: one row per organization, account and period with running totals, updated in the posting transaction with optimistic locking.
6. Posting rules as data: document type plus line kind plus tax class resolve to accounts through a rule table with priority and effective dates; system accounts are seeded per legal-type template, not hard-coded to hospital revenue categories.
7. Tax tables: rate schedules keyed by HSN or SAC with `effectiveFrom` and `effectiveTo`; a document line snapshots the rate row id it used. TDS sections and rates the same way.
8. Period lock: per organization, general and tax lock dates, with scoped exceptions that record who, why, and until when. Filing a return sets the tax lock.
9. Command log: every mutation stored as a named command with client id, device sequence, actor, payload digest and result. Replayable, idempotent. This is the offline seam.
10. Audit: keep the fire-and-forget rule for sensitive actions; add field-level version diffs on documents, universal for every tenant. Add a hash chain per organization and journal later if auditors ask; the columns cost nothing now.
11. Reports: a formula table (statement, line, account-code expression, sign) evaluated over balances, so the CA's format is data.
12. Read model for agents: a documented, curated view (documents, parties, balances, calendar) and a change feed; write tools only through document commands with approval.

## 7. Sources

Open-source code: `github.com/frappe/books` (schemas/app, models/Transactional, backend/patches); `github.com/frappe/erpnext` (accounts/general_ledger.py, doctype/gl_entry, payment_ledger_entry, accounting_period, period_closing_voucher, tax_rule, stock/doctype/repost_item_valuation); `github.com/resilient-tech/india-compliance` (hooks.py, patches.txt); `github.com/odoo/odoo` 19.0 (addons/account/models/account_move.py, account_move_line.py, account_tax.py, account_report.py; addons/l10n_in); `github.com/akaunting/akaunting` (single-entry, not a reference).

Closed products: zoho.com/books/api/v3 (journals, invoices, transaction-locking, credit-notes, webhooks, chart-of-accounts); zoho.com/in/books/help/gst/ims.html; zoho.com/in/books/e-invoicing; help.tallysolutions.com (xml-integration, odbc-integrations, developer-reference, data-migration-data-corruption-faq); tallysolutions.com/tally/audit-trail-in-tallyprime; developer.xero.com (manualjournals, history-and-notes); help.xero.com/us/Settings_LockDate; productideas.xero.com lock-date thread; QuickBooks SyncToken and CDC via integration-vendor summaries (primary not fetched).

Engines and patterns: docs.tigerbeetle.com/concepts/performance; formance.com/blog/engineering/numscript; github.com/pgr0ss/pgledger and pgrs.net 2025-03-24; docs.moderntreasury.com/ledgers; developer.squareup.com/blog/books-an-immutable-double-entry-accounting-database-service; river.com/content/we-replaced-our-ledger-with-two-functions; infoq.com/news/2026/06/uber-payment-batching-system; martin.kleppmann.com/2011/03/07/accounting-for-computer-scientists; inkandswitch.com/essay/local-first; replicache.dev; docs.powersync.com/overview/powersync-philosophy; github.com/evoluhq/evolu; groups.google.com/g/dddcqrs/c/LPBPw9JMIDI; docs.stripe.com/api/tax_rates/object; knowledge.avalara.com (rate updates and effective dates); taxguru.in Notification 9/2025-CT(Rate); postgresql.org/docs/current/ddl-partitioning.html; truto.one Pennylane MCP write-up; puzzle.io/blog/puzzle-accounting-ai; Digits coverage at insightfulaccountant.com.
