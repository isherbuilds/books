# Spec: Query performance at volume

Status: S1–S3, S5 and S6 implemented; S4's party statement timing and S7 open
Authority: the owner's request of 2026-09-28 (trigram substring search, option 3).
The accounting-core Deferred entry "Period-close balance snapshot" keeps its gate.

## Problem

Slow reads hold pool connections and delay other users. At volume, search,
settlement pickers, balance sums and oversized exports need bounded reads.

## Solution

Same screens and results: trigram substring search, seekable party and period
filters, index-only balance sums and reversal checks, fast oversized-export
refusal, and a bounded pool wait. Stored balances stay deferred until a real
organization's volume needs them.

## Validation / Evidence

**Fixture:** local Docker PostgreSQL 18, `shared_buffers` 128 MB. The mega seed
holds Meridian Traders (2.2 M journal lines, about 1 M documents, 200 k receipts)
and Ridgeview Academy (3.5 M lines, 320 k receipts).

**Id caveat:** the mega seed builds ids from md5 hashes; the app writes UUIDv7.
Id order is not date order in this fixture, so id-keyset plans can differ.

### Search and party filters

**Method:** `accly_perf`, a clone of the dev database with journal and
document-line tables dropped (registers read neither), after `VACUUM ANALYZE`.
The API runs with `bun src/index.ts`, with fixed inputs and row equality checks.

`registerPage` checks the newest 1,000 documents first, then uses the trigram
index for older ones only when the page is not full. Across 58 checks
(2 organizations, receipts, invoices and journals, 8 terms, two pages each),
results matched the single query in 5–191 ms. Ridgeview's search for "Vardhman",
a Meridian party absent from Ridgeview, takes 15–39 ms. An older-history term
with 9,062 matches (Meridian "Vardhman" forced past the window) takes 196–350 ms
warm and 1.7 s cold in SQL.

The GIN index is about 225 MB; the party index is 345 MB. A fragment with many
matches takes 42–91 ms because the bitmap collects every match before sorting;
the first call after a restart can take 1.5 s.

**`org_id` in the trigram index (`btree_gin`): rejected.** Warm median of 5
`registerPage` calls on `accly_perf`, plain → with `org_id`, in ms:
exact number 149 → 70 (Meridian), 147 → 130 (Ridgeview); another organization's
name 54 → 38, 40 → 12; number fragment 3 → 14, 5 → 21; own common name
14 → 22, 17 → 29. Index sizes: 225 and 228 MB. No clear gain at 3 organizations
for an extra extension; revisit when cross-organization search misses its target
at many tenants.

### Pickers and export probes

**Reversal check:** `benchmark:rpc`, 10 requests after 20 warm-up, API on
`accly_perf`. Ridgeview p50 / p95 in ms: `party_open_items` (busiest customer)
1,408 / 1,830; `party_open_credits` 1,554 / 2,380; Invoice/Credit Note first
pages 7–15. Meridian's final API measurements are below.

Ridgeview's remaining picker cost is the walk past paid documents (Explicitly
Deferred). The one-target reversal check uses an index-only scan of
`allocations_org_reverses_idx`, about 130 buffers.

**Size probes:** 3 calls each against the dev database; the first call after a
restart is slowest. The party statement refusal timing remains open against the
300 ms gate.

| Call                                           | Current time (ms) / outcome |
| ---------------------------------------------- | --------------------------- |
| `export.accountLedgerXlsx`, 550 k lines (M)    | 30–743, `REPORT_TOO_LARGE`  |
| `report.accountLedger` (PDF), 99,946 lines (M) | 13–52                       |
| `export.partyStatementXlsx`, 160,800 lines (R) | 19–554                      |
| `party.statement` (PDF), 21,500 lines (R)      | 7–25                        |

### Current read measurements

**Full API benchmark:** Meridian, 100 reads and 14 writes, each response checked,
on one data copy with the final schema; production APIs, 20 timed reads after
5 warm-up (writes: 20 after 3), with browser-like cookies
([method and results](../research/api-benchmark-2026-09-28.md)). Current p50:
register search for a number, fragment or miss 5–11 ms; party filters on bills
and payments 6–8 ms; Open items and Open credits 168 and 65 ms; money balances
87 ms; party balances 40 ms; account ledger summary 37 ms; oversized ledger XLSX
refusal 10 ms. Statements stay about 300 ms. A common term sparse among the
newest 1,000 documents takes 27–41 ms; a payment post costs about 1.5 ms more.

At 2.2 M Meridian lines, that benchmark measures TB/P&L/BS p50
306.4/302.5/317.3 ms and p95 416.2/319/321.3 ms. This larger fixture is distinct
from the 210,124-line native-PostgreSQL production-API measurement below.

**Balance sums:** `benchmark:rpc`, 20 requests after 20 warm-up, dev database,
with probe indexes of the final shape. Ridgeview p50 in ms: money balances 161,
cash account-ledger summary 59, party balances 59, party-ledger summary 8.
Meridian's final API party-ledger summary is p50 4.3 ms (p95 5.1 ms); its other
balance reads are above.

Cold `psql`: Meridian cash balance 316 ms; receivables ledger summary (550 k
lines) 412 ms; `party.balances` 64 ms, an index-only scan of the widened
`party_ledger_lines_org_party_idx` (18 MB).

**File cursor:** 180,000 synthetic files in a rolled-back transaction, a page
150,000 deep: the row comparison is an Index Cond and takes 0.06 ms.

**Pool:** with all 10 connections held by `pg_sleep(8)`, the next query fails
after 5,006 ms.

**Posting:** within the 30 ms budget. A 5-line invoice takes about 7 ms of
statements; a receipt against 3 invoices takes 10–15 ms. Auth and membership
cost 2 round trips per request, well under a millisecond each.

**Registers (M10):** Ridgeview's 100,019 Receipts, October 2026 default period,
first 25 rows (`LIMIT 26`), `EXPLAIN (ANALYZE, BUFFERS)`: date/id scan with a
seekable period 21.4 ms (23 buffers hit / 7 read). Its largest party (11,696
Receipts): October party/date/id scan 32.2–84.4 ms (30–31 hit / 0–1 read);
all-time 2.6–8.3 ms (41 hit / 0 read).
End-to-end `receipt.list`, same fixture and period, 10 timed calls after warm-up:
first-page p50 62–145 ms across three runs, no errors. Second page and
largest-party October page p50 23–125 ms (loaded-machine noise). The 16-worker
load run reaches 72 req/s with 0 errors. The RPC page-order check follows
(document date, id).

**Import:** Meridian at `db:seed:volume`, production API build, 20 runs:
1,000 parties and 5,000 items, `import.commit` p95 1.29 s, `import.check` 107 ms;
5,000 parties, p95 1.55 s and 132 ms. Bulk 1,000-row inserts into `documents`
and `party_ledger_lines` dominate; no single statement is slow.

**Reports:** 210,124 Meridian journal lines, native Docker PostgreSQL after
`VACUUM ANALYZE`, production API build, 200 requests each for a 365-day period:
RPC p95 39.7 ms (`trial_balance`), 37.8 ms (`profit_and_loss`), 39.3 ms
(`balance_sheet`), all under 100 ms. Warm `EXPLAIN (ANALYZE, BUFFERS)` shows
parallel sequential scans of `journal_lines`: 41.2, 30.8, 30.2 ms respectively,
each with 11,373 shared buffers hit and none read.

**Paged ledgers:** at 210,124 Meridian lines on native PostgreSQL, warm
`EXPLAIN (ANALYZE, BUFFERS)`: account summary parallel sequential scan 22.4 ms
(11,357 buffers hit, none read), first-page index scan 0.4 ms (216 hit).
Day-book summary parallel sequential scans of lines and entries 51.1 ms
(12,207 hit, 5,194 read); first-page index-only entry scan 0.1 ms (5 hit),
indexed detail 0.6 ms (498 hit). At mega-volume Meridian (1.3M journal lines),
warm page queries take 0.1–3 ms; period summaries take account 165–390 ms,
day book 120–770 ms, party 14–80 ms.

**Settlement reads:** `EXPLAIN ANALYZE` at `db:seed:volume` (100,000 Receipts per
organization, 44,000 party ledger lines, no Invoices): a 25-row register with
balances 0.3–0.6 ms; Invoice list and open filter 0.1 ms; `party.openItems`
0.1 ms; `party.openCredits` for 5,799 open advances 55 ms. The fixture predates
25-row picker paging and has no Journals; it does not close the allocated
Invoice/Bill and Journal volume checks in the registry.

## Scenarios

The gates below cover small-party reads, substring search (including common
names and number fragments), balance sums, oversized-export refusal, deep file
paging and pool starvation without changing results or error codes.

## Implementation Decisions

1. **Trigram search.** `runMigrations` creates trusted `pg_trgm` under its advisory
   lock before `migrate()`, including after test resets drop `public`. No migration
   file carries the extension; the database owner needs no superuser.
2. **One search column.** `documents.search_text` is stored/generated from number,
   reference, narration and printed party name, joined with spaces and `coalesce`,
   with one GIN `gin_trgm_ops` index. `registerPage` uses `likePattern` and one
   `ILIKE`, newest 1,000 documents first, then older indexed matches if needed.
   Matching across adjacent fields is allowed. `documentSearchQuery` requires
   3 letters or digits in a row: registers hint and ignore shorter terms; the
   palette waits until the term qualifies. File search has no trigram index.
3. **Register keysets.** Registers page newest document date first with an id
   cursor resolved inside the page statement (`dateCursor`). Only Invoice
   and Bill periods retain the draft exemption. Type/date/id and party/date/id
   indexes serve register filters; party/id remains for `party.transactions`.
4. **Index-only balance sums.** `journal_lines_org_account_date_idx` ends in
   `debit, credit`, after `(org_id, account_id, entry_date, id)`; Drizzle 0.45
   has no `INCLUDE`. Both party/date and party indexes end in `amount_paise`.
   The keyset prefix is unchanged. These serve money balances, account-ledger
   summary/opening, party-ledger summary and party balances, not TB/P&L/BS
   (a covering index gave no gain; JS grouping was 9× slower).
5. **No unused unique indexes.** `journal_lines_org_id_id_unique`,
   `party_ledger_lines_org_id_id_unique` and `file_org_id_id_unique` back no
   foreign key and are removed.
6. **Reversal check.** `reversalOf` has no `kind` predicate:
   `allocations_kind_check` makes non-null `reverses_allocation_id` imply
   `kind = 'reverse'`. No planner hint. `settlementPaise` nets applies minus
   reversals in one allocation scan; a reversal copies its apply's source,
   target and amount, and `allocations_org_reverses_idx` allows one per apply.
   Outstanding/unapplied is the document's single `post` party ledger line
   (unique indexed lookup) less its active applies.
7. **Exports fail fast.** `assertReportFits` probes position `limit` through
   the account/party date/id index before the joined detail query; a row there
   throws `reportTooLarge(limit)` with the same code and message. Post-query
   `detail.length > limit` checks stay: the party statement's probe and rows
   run outside one transaction and can disagree. Day book gets no probe:
   its join-based probe took 2.4–5.9 s versus 1.7–4.3 s without it; an extra
   `(org_id, entry_date)` journal-line index is not justified for refusal.
   Day-book limits/message and tax-register bounds stay as specified below.
8. **File cursor.** `file.list` uses `(created_at, id) < (…)`, as `afterCursor`
   does for dates. Paging across equal `created_at` stays complete and ordered.
9. **Pool.** `connectionTimeoutMillis` is 5,000 ms; `max` stays at pg's default 10. Slow reads, not pool size, caused starvation.
10. **Cookie cache.** Keep `session_data` with `Max-Age=300`. Every adapter forwards
    the `Set-Cookie` returned by session resolution, so refreshed cookies reach
    the client. A revocation can take up to 5 minutes to apply.

## Test Seams

- **`scripts/benchmark-rpc.ts`** covers `receipts_party_small`,
  `receipts_query_number` (5 characters from a real number's middle),
  `receipts_query_miss`, `party_balances`, `party_open_items` (busiest receivable
  party), `account_ledger_summary` (most-lined account, this financial year),
  money balances and all three statements. Pick ids and terms from the data
  at start-up; hard-code none.
- **Real PostgreSQL integration tests:** receipt/invoice/bill/payment/note for
  search and party filters; allocation/receipt/note for reversal-aware balances;
  report for ledger/day-book/statement limits; files for paging; tenancy for org
  predicates. Cover substrings of all 4 search fields, an over-limit
  `REPORT_TOO_LARGE` per probe shape and equal-`created_at` cursor rows.
- **`EXPLAIN (ANALYZE, BUFFERS)`** records changed query plans in this owner doc.

## Task Plan

S1–S3, S5 and S6 are implemented. Their contracts are above; retained gates:

- Party filter under 50 ms; number/miss search under 100 ms and common-term
  search no slower than 50 ms.
- `moneyBalances` and `party.balances` under 300 ms;
  `party.ledgerSummary` under 100 ms; `accountLedgerSummary` under 200 ms.
- Measure warm median of 5 runs after `VACUUM ANALYZE`, with query plans;
  remove temporary probe indexes. A miss revises the index or moves the read
  to Explicitly Deferred with its measured number.
- File deep page under 5 ms at 180 k files, using an Index Cond on
  `file_org_created_idx`; synthetic fills roll back.
- Pool starvation errors after a bounded wait. Sign-in, sign-out, org switch
  and expired sessions continue to work in the running app.

**S4: Exports fail fast — open party statement timing.** Account ledger and
party statement XLSX/PDF over the limit must throw `REPORT_TOO_LARGE` in under
300 ms on Meridian's receivables account and Ridgeview's top party. Within-limit
output is unchanged. Next: timed dev-API calls, report/party/export integration
coverage (one over-limit test per probe shape where absent), and the PDF link
returning the refusal in the app. Owners: report, party and export routers,
`lib/reports.ts`, `lib/gst-register-rows.ts`, accounting-core. `reportTooLarge`
stays unchanged. Day-book probe and tax bounds remain deferred.

**S7: Close out — open.** Confirm S1–S6 evidence is recorded in this owner doc;
accounting-core's period-close snapshot cites current TB/P&L/BS evidence without
changing its gate; every deferred item has an owner and gate. Depends on S2–S6.
Owners: registry, accounting-core, this spec. Check: `bunx oxfmt --check docs/`.

## Out of Scope

- A search engine, `tsvector` ranking, fuzzy or typo-tolerant matching.
- Changing page sizes.
- PostgreSQL config tuning such as `shared_buffers` or `work_mem`.
- UI loading: report routes keep non-blocking loaders and `ListState`, without
  skeletons (design §9).

## Explicitly Deferred

- **Stored balances per account and period** (period-close snapshot). Statements
  grow with history; [current measurements](#current-read-measurements) bound the
  evidence. Extra posting inserts and a second ledger copy risk drift;
  period-close snapshots are the next step if needed
  ([architecture research](../research/tigerbeetle-architecture-2026-09-28.md)).
  Gate: a statement misses p95 100 ms at a real organization's volume.
- **Counter-sale number-series lock.** Held through every receipt.
  Gate: posting p95 over budget with concurrent counter sales in one organization.
- **Journal posting loops per party.** One insert, lock and balance read per party.
  Gate: a real journal with more than 20 parties.
- **Streaming XLSX.** 100 k rows cost about 400 MB RSS.
  Gate: concurrent large exports on the production host.
- **Day book PDF on a busy day, and a fast day book refusal.** Limit 5,000 lines;
  Meridian has 18,214 lines/day. A month's XLSX takes 1.7–4.3 s to refuse.
  Gate: a real organization's single day over the limit.
- **GST and TDS register row bound.** No cap.
  Gate: the first organization with taxable volume, or the streaming XLSX gate.
- **Invoice/Bill date-range draft exemption under UUIDv7 ids.** The draft `OR`
  can defeat the date index. Gate: measured on v7-id data.
- **`status = open/overdue` on mostly paid history**, and picker walks past paid
  documents. Gate: measured on a mostly paid fixture.
- **Day book summary over a full year** (1–4.7 s); default range is one day.
  Gate: a user-reported need for wide ranges.
- **File name search index.** 380 ms at 180 k files.
  Gate: a user-reported slow search on Settings → Files.
- **Search terms common only in old history** still read every older match.
  Gate: measured p95 over 500 ms on a real organization's search.
- **Prepared statements** save about 1 ms of planning; not worth the API surface.

## Open Questions

None.
