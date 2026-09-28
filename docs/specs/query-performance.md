# Spec: Query performance at volume

Status: ready
Authority: the owner's request of 2026-09-28 ("spec this out — all the above issues
and audits and suggest to fix them"; search: trigram substring search, option 3).
Supersedes: none. Patches the accounting-core Deferred entry "Period-close balance
snapshot" only with new evidence; its gate is unchanged.

## Problem

At volume, several everyday reads take seconds, and some take minutes cold:

- A party's Transactions tab, its overview, and every register filtered by party
  walk the whole register when the party has few documents.
- Register and palette search with a rare term, or a document number, reads every
  document of the type.
- The dashboard and Banking sum the full history of every cash and bank account on
  each load.
- The Receipt and Payment pickers take 3.5 s.
- Account ledger, day book and party statement exports can run 13–45 s and then
  refuse as too large.

Slow reads also hold pool connections, so one user's slow search delays other users'
requests.

## Solution

Same screens, same results, faster:

- Search keeps matching any part of the number, reference, narration or party name,
  now through a trigram index.
- Party filters seek the party's own documents.
- Balance sums read only an index.
- The reversal check reads only its own index.
- Oversized exports refuse at once.
- The pool fails loudly instead of queueing forever.

The trial balance, P&L and balance sheet stay as they are (about 0.4 s at 2.2
million lines). A stored-balance design stays deferred until a real organization's
volume needs it.

## Validation / Evidence

Internal maintenance, owner-funded. The audit ran on 2026-09-28: four read-only
agents, plus spot checks on a quiet database.

**Fixture:** local Docker PostgreSQL 18, `shared_buffers` 128 MB. The mega seed
holds Meridian Traders (2.2 M journal lines, about 1 M documents, 200 k receipts)
and Ridgeview Academy (3.5 M lines, 320 k receipts).

**Id caveat:** the mega seed builds ids from md5 hashes, while the app writes
UUIDv7. Here id order is not date order, so some keyset plans will differ in
production.

| Read                                                    | Baseline                                       | Cause                                                                                                       |
| ------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `receipt.list` with `partyId`, party with 1 receipt (R) | 28.4 s cold (verified)                         | `documents_org_party_idx` is `(org_id, party_id)`, so the plan walks `(org_id, type, id)` and filters       |
| `receipt.list` with `q`, exact number (M)               | 5.1 s cold / 2.7 s warm (verified)             | `ILIKE '%q%'` on 4 fields, no usable index                                                                  |
| `receipt.list` with `q`, no match (M)                   | 5.5 s cold / 5–9 s warm (verified)             | Same                                                                                                        |
| `receipt.list` with `q`, common name (M)                | 104 ms cold / 7 ms warm (verified)             | Many matches end the walk early                                                                             |
| `account.moneyBalances` (M)                             | 4.7 s (verified); benchmark p50 760 ms         | Heap fetch per line for 351 k lines                                                                         |
| `party.balances` (M / R)                                | 714 / 798 ms                                   | Parallel seq scan of all `party_ledger_lines`                                                               |
| `party.ledgerSummary` (M / R)                           | 172 / 211 ms warm, 3.2 s cold                  | Heap fetch per party line                                                                                   |
| `report.accountLedgerSummary`                           | 0.3–1.1 s                                      | Seq scan of 1.2 GB `journal_lines` for one account                                                          |
| `party.openItems` / `openCredits` (M)                   | 3.6 / 3.5 s                                    | Reversal anti-join walks all reversal rows through the heap; 1.02 M buffers                                 |
| Reversal check alone, one target document (R)           | 1,074 buffers; 130 without `kind` (verified)   | `kind = 'reverse'` forces a heap visit; `allocations_kind_check` already implies it                         |
| `export.accountLedgerXlsx` over the limit               | 13–45 s, then `REPORT_TOO_LARGE`               | Full join before the limit check                                                                            |
| `export.dayBookXlsx`, one month                         | about 5 s, then `REPORT_TOO_LARGE`             | Same                                                                                                        |
| `export.partyStatementXlsx`, top party (R)              | 3–5 s, then `REPORT_TOO_LARGE`                 | Same                                                                                                        |
| `file.list` deep cursor, 180 k files                    | 234 ms                                         | `OR` cursor is not an index condition; the row comparison measured 0.05 ms                                  |
| `file.list` with search                                 | 380 ms                                         | `ILIKE '%q%'` on `name`                                                                                     |
| TB / P&L / BS (M, dev API)                              | p50 389 / 398 / 427 ms, p95 428 / 480 / 502 ms | CPU-bound grouped sum over all lines. A covering index and JS grouping were tested: no gain, and 9× slower. |

The posting path is within its 30 ms budget: a 5-line invoice takes about 7 ms of
statements, and a receipt against 3 invoices 10–15 ms. Auth and membership cost 2
round trips per request, well under a millisecond each.

### S1 measured: party index and trigram search (2026-09-28)

**Method:**

- Clone of the dev database (`accly_perf`), with the journal and document-line
  tables dropped; the register reads neither. `VACUUM ANALYZE` was run before each
  phase.
- The same API code, run with `bun src/index.ts`, with fixed inputs across phases.
- The before phase ran commit `11671fe`. The after phase applied Drizzle's
  generated `0001` statements plus `pg_trgm`, then ran this branch.
- Each cell below is 5 sequential `receipt.list`, `invoice.list` or `bill.list`
  calls. Row counts were identical before and after.

| Scenario                                       | Meridian before → after (ms)      | Ridgeview before → after (ms)               |
| ---------------------------------------------- | --------------------------------- | ------------------------------------------- |
| Party filter, invoices, party with no invoices | 13–88 → 7–53 (party has invoices) | **4,296–11,868 → 7–18**                     |
| Party filter, receipts                         | 12–1,930 → 6–40                   | 3–4 → 6–14                                  |
| Search, exact number                           | **1,382–3,927 → 66–329**          | **2,430 to timeout at 15 s → 4–6**          |
| Search, last 6 characters of a number          | **1,385–2,611 → 5–6**             | 15–55 → 42–91 (common fragment, 25 matches) |
| Search, no match                               | **1,362–1,604 → 5–7**             | **2,362–3,554 → 3–5**                       |
| Search, common first name                      | 19–33 → 5–87                      | 6–17 → 5–6                                  |
| First page, no filter                          | 4–34 → 5–31                       | 4–9 → 6–10                                  |

**Cost:**

- The GIN index takes 224 MB.
- The party index grew to 345 MB.
- Applying the change to 2.6 M documents took 3.5 minutes, most of it rewriting the table for the stored column.

**Remaining regressions:** a fragment that matches many documents costs 42–91 ms
instead of 15–55 ms. The bitmap collects every match, then sorts. The first call
after a restart can be cold, up to 1.5 s.

### Built and measured in the first PR (2026-09-28)

**Reversal check (decision 6).** `benchmark:rpc`, 10 requests after 20 warm-up,
branch API on the `accly_perf` clone, p50 and p95 in ms:

| Scenario                                         | Meridian             | Ridgeview                         |
| ------------------------------------------------ | -------------------- | --------------------------------- |
| `party_open_items` (busiest customer)            | 579 → 358; 845 → 556 | **5,390 → 1,408; 13,489 → 1,830** |
| `party_open_credits`                             | 648 → 376; 960 → 594 | 3,067 → 1,554; 3,536 → 2,380      |
| `invoices_first_page`, `credit_notes_first_page` | 7–14, unchanged      | 7–15, unchanged                   |

The rest of Ridgeview's picker time is the walk past paid documents (Explicitly
Deferred).

**Size probes (decision 7).** 3 calls each against the dev database, ms and
outcome:

| Call                                                         | Before                                    | After                      |
| ------------------------------------------------------------ | ----------------------------------------- | -------------------------- |
| `export.accountLedgerXlsx`, 550 k lines (M)                  | **15,148–15,213, statement timeout, 500** | 30–743, `REPORT_TOO_LARGE` |
| `report.accountLedger` (PDF), 99,946 lines (M)               | 144–1,367                                 | 13–52                      |
| `export.partyStatementXlsx`, 160,800 lines (R)               | 5,637–8,640                               | 19–554                     |
| `party.statement` (PDF), 21,500 lines (R)                    | 79–1,185                                  | 7–25                       |
| `export.dayBookXlsx`, one month (M), probe tried and dropped | 1,662–4,288                               | not shipped                |

The first call after a restart is the slowest in every row.

## Scenarios

1. **Before:** opening a small party's Transactions tab on Ridgeview takes about
   28 s. **After:** under 50 ms.
2. **Before:** typing `MV26-27/135310` in the palette runs five register walks of
   2.7–9 s each. **After:** each register search is under 100 ms warm. Typing "35310"
   still finds the receipt, and a common name still returns the newest matches first.
3. **Before:** the dashboard waits about 4.7 s for cash and bank balances. **After:**
   under 300 ms.
4. **Before:** the Receipt form's Open items picker takes 3.6 s. **After:** it takes
   the time S1 records, and the reversal check reads only `allocations_org_reverses_idx`.
5. **Before:** an account ledger XLSX over 100,000 lines runs up to 45 s, then fails.
   **After:** it fails with the same `REPORT_TOO_LARGE` message in under 300 ms. The
   day book and party statement exports behave the same way.
6. **Before:** a deep page of Settings → Files takes 234 ms. **After:** under 5 ms.
7. **Before:** a request that cannot get a pool connection waits without limit.
   **After:** it fails loudly after a bounded wait.

## Implementation Decisions

1. **Trigram search (option 3).**
   - Enable `pg_trgm` with `create extension if not exists pg_trgm` in
     `runMigrations` (`packages/db/src/migrate.ts`), under the existing advisory
     lock, before `migrate()`.
   - No migration file carries the extension, so hard rule 4 holds. Amend rule 4 in
     `CLAUDE.md` and `docs/architecture.md`: "Extensions the schema needs are created
     by `runMigrations`; no migration file carries them."
   - `pg_trgm` is a trusted extension, so the database owner can create it without
     superuser. Record that in `docs/operations.md`.
   - Test resets drop `public`, which drops the extension. `runMigrations` then
     recreates it, so tests need no change.
2. **One search column.**
   - `documents` gains a stored generated column `search_text`: number, reference,
     narration and the printed party name joined with spaces, each wrapped in
     `coalesce`. It gets one GIN `gin_trgm_ops` index.
   - `documentListWhere` (`lib/settlements.ts`) replaces its four `ILIKE`s with one
     `ILIKE` on `search_text`, using the same `likePattern`.
   - One index and one predicate replace four, and results do not change. A term can
     now match across two adjacent fields, which is harmless.
   - `file` gains a GIN trigram index on `name`.
   - Terms under 3 characters cannot use a trigram index. They keep today's walk,
     which is fast because short terms match often. The palette minimum stays at 2.
3. **Party filter.** Change `documents_org_party_idx` to `(org_id, party_id, id)`. It
   is a superset of today's index, so it serves the party filter,
   `party.transactions` and every current user.
4. **Index-only balance sums.**
   - Append `debit, credit` to `journal_lines_org_account_date_idx`, giving
     `(org_id, account_id, entry_date, id, debit, credit)`. Drizzle 0.45 has no
     `INCLUDE`, so these are trailing key columns.
   - Append `amount_paise` to `party_ledger_lines_org_party_date_idx`.
   - The account ledger keyset still seeks the same prefix.
   - This targets `moneyBalances`, `accountLedgerSummary`, the account ledger
     opening, `party.ledgerSummary` and `party.balances`. It does not target
     TB/P&L/BS: tested, no gain.
5. **Drop dead unique indexes.** `journal_lines_org_id_id_unique` (781 MB) and
   `party_ledger_lines_org_id_id_unique` (308 MB) back no foreign key; the schema was
   searched. Each posted line pays for them, so remove both.
6. **Reversal check.** `reversalOf` (`core/allocations.ts`) drops
   `eq(reversal.kind, "reverse")`. `allocations_kind_check` makes a non-null
   `reverses_allocation_id` mean `kind = 'reverse'`, so the results do not change. No
   planner hint such as `OFFSET 0`.
7. **Exports fail fast.**
   - Before the joined detail query, one index-only probe checks whether a row
     exists at position `limit`. If it does, throw `reportTooLarge(limit)` with the
     same code and message.
   - Account ledger and party statement probe their existing `(org, account|party,
entry_date, id)` index through `assertReportFits` (`lib/reports.ts`).
   - The day book gets no probe. Counting its lines needs a join of entries to
     lines, and the planner hash-joins a sequential scan of `journal_lines`: the
     probe measured 2.4–5.9 s against 1.7–4.3 s without it. An exact probe needs a
     new `journal_lines (org_id, entry_date)` index, which a refusal does not
     justify. Its limits and message are unchanged.
   - The existing post-query `detail.length > limit` checks stay. The party
     statement reads outside one transaction, so its probe and rows can disagree.
   - The GST outward, GST inward and TDS row bound moves to Explicitly Deferred:
     it caps memory, and this pass ships only measured speed.
8. **File cursor.** `file.list` uses a row comparison `(created_at, id) < (…)`
   instead of the `OR`, as `afterCursor` does for dates.
9. **Pool.** `packages/db/src/index.ts` sets `connectionTimeoutMillis` (5,000 ms), so
   a starved pool fails loudly. `max` stays at the pg default of 10. The slow queries
   above, not the pool size, caused the starvation.
10. **Cookie cache.**
    - Remove `session.cookieCache` from `packages/auth/src/index.ts`, but only if the
      slice confirms that no response refreshes the `session_data` cookie after
      sign-in: no `Set-Cookie` on `/rpc`, and no client `get-session` polling.
    - If something does refresh it, keep the cache and record why.
11. **One database reset.** All schema changes (1–5) land in one slice. Per rule 4
    and `docs/development.md`, that means: delete the baseline, run
    `bun run db:generate`, run `bun run db:seed -- --reset`, then refill the volume
    fixture with `bun run db:seed:mega`. The reset deletes local data and needs the
    owner's explicit confirmation right before it runs.

## Test Seams

- **`scripts/benchmark-rpc.ts`** is the performance guard. Add scenarios:
  - `receipts_party_small`: `receipt.list` with the party with the fewest receipts.
  - `receipts_query_number`: a real receipt number, 5 characters from its middle.
  - `receipts_query_miss`: a term with no match.
  - `party_balances`: `party.balances`.
  - `party_open_items`: `party.openItems` for the busiest receivable party.
  - `account_ledger_summary`: the account with the most lines, this financial year.
  - Keep `money_balances` and the three statements.

  Pick every id and term from the data at start-up; hard-code none.

- **`tests/integration/*`** (real PostgreSQL) are the behaviour guard:
  - `receipt`, `invoice`, `bill`, `payment` and `note` for register search and the
    party filter.
  - `allocation`, `receipt` and `note` for reversal-aware balances.
  - `report` for the ledger, day book and statement limits.
  - `files` for paging.
  - `tenancy` for org predicates.

  Run the covering tests first. Add a test only where no test covers:
  - Search matching a substring of each of the 4 fields.
  - An over-limit export returning `REPORT_TOO_LARGE`, one per probe shape.
  - A file cursor page across rows with equal `created_at`.

- **`EXPLAIN (ANALYZE, BUFFERS)`** on the dev database records the plan shape for
  each changed query, in the work registry.

## Task Plan

- [ ] **S1: Prove the indexes before the reset** (party and search proven; see
      "S1 measured") (riskiest: extension, planner
      choice on a GIN index without `org_id`)
  - Acceptance:
    - On the current mega data, after `VACUUM ANALYZE`, create each index from
      decisions 1–4 as a probe. Probe `search_text` as a GIN expression index on
      the same concatenation, queried by that expression, so the table does not
      change. Record the warm median of 5 runs and the plan for
      every row of the Evidence table that decision 1–4 targets. Then drop every
      probe.
    - Targets, provisional until this slice records the numbers:
      - party filter under 50 ms;
      - search (number, miss) under 100 ms, with the common term no slower than 50 ms;
      - `moneyBalances` under 300 ms;
      - `party.balances` under 300 ms;
      - `party.ledgerSummary` under 100 ms;
      - `accountLedgerSummary` under 200 ms.
    - If a probe misses its target, revise decisions 1–4 before S2. Either change
      the index, or drop it and move the read to Explicitly Deferred with the
      measured number.
    - Results are written into this spec's Evidence table, marked "S1".
  - Verify: `psql` `\timing` and `EXPLAIN (ANALYZE, BUFFERS)` through
    `docker exec accly-db-dev-postgres psql -U postgres -d postgres`. The probe DDL
    runs only on the local dev database, and every probe is dropped after.
  - Depends on: none
  - Owns/Touches: `docs/specs/query-performance.md` (Evidence and Decisions only)
  - Interfaces: produces the final index shapes consumed by S2.

- [ ] **S2: Schema and search, one reset** (first PR: `pg_trgm`, `search_text`
      and the party index, with the baseline regenerated; the balance-sum, file-name
      and dead-unique index changes remain, and need S1 numbers first)
  - Acceptance:
    - `runMigrations` creates `pg_trgm`.
    - Drizzle schema changes: `documents.search_text` and its GIN index,
      `documents_org_party_idx` as `(org_id, party_id, id)`, the two widened ledger
      indexes, the file-name GIN index, and the two dead unique indexes removed.
    - One regenerated baseline, the database reset with confirmation, and the mega
      fixture refilled.
    - `documentListWhere` uses `search_text`.
    - `file.list` search uses its index.
    - `benchmark:rpc`, including the new scenarios, meets S1's targets.
    - Register search results match today's on the integration tests.
  - Verify:
    - `bun run db:generate` (a single baseline file);
    - `bun run test`, which owns `accly_test` for its run;
    - `bunx oxlint`, `bunx oxfmt --check .`, and type checks;
    - `bun run benchmark:rpc` against the dev API, with `PERF_ORG_SLUG` set to
      Meridian, then to Ridgeview;
    - palette search for a document number in the running app, at desktop and 390 px.
  - Depends on: S1
  - Owns/Touches:
    - `packages/db/src/migrate.ts`
    - `packages/db/src/schema/{documents,file,journal-lines,party-ledger-lines}.ts`
    - `packages/db/src/migrations/**` (generated only)
    - `packages/api/src/lib/settlements.ts` (`documentListWhere`)
    - `packages/api/src/routers/file.ts` (search predicate only)
    - `scripts/benchmark-rpc.ts`
    - `CLAUDE.md` (rule 4)
    - `docs/architecture.md`, `docs/development.md`, `docs/operations.md`
  - Interfaces: `documents.searchText` (Drizzle column); `documentListWhere(orgId,
types, input)` signature unchanged.

- [x] **S3: Reversal check reads its own index** (first PR)
  - Acceptance:
    - `reversalOf` has no `kind` predicate.
    - On the note-outstanding and one-target-document checks, buffers fall from
      about 1,074 to about 130, with an Index Only Scan on
      `allocations_org_reverses_idx`.
    - `party.openItems` and `openCredits` are re-timed, and the numbers are recorded
      in the registry.
    - Allocation, receipt and note integration tests pass unchanged.
  - Verify: `EXPLAIN (ANALYZE, BUFFERS)` before and after; `bun run test`
    (covering files).
  - Depends on: none. Parallel-safe with S4–S6: disjoint files.
  - Owns/Touches: `packages/api/src/core/allocations.ts`
  - Interfaces: `reversalOf`, `activeApply` and `allocationReversed` signatures
    unchanged.

- [ ] **S4: Exports fail fast; tax registers bounded** (first PR: ledger and
      statement probes; day book dropped, tax bound deferred)
  - Acceptance:
    - Account ledger XLSX and PDF, day book XLSX and PDF, and party statement XLSX
      and PDF: when over the limit, each throws `REPORT_TOO_LARGE` in under 300 ms on
      Meridian's receivables account and Ridgeview's top party.
    - Within the limit, the output is unchanged.
    - The day book keeps its line limits; see decision 7.
  - Verify:
    - timed calls through the dev API before and after;
    - `bun run test` (report, party and export coverage), adding one over-limit
      test per probe shape only where none exists;
    - the PDF link in the running app returns the message.
  - Depends on: none
  - Owns/Touches:
    - `packages/api/src/routers/report.ts` (`accountLedger`, `dayBook`)
    - `packages/api/src/routers/party.ts` (`partyStatement`)
    - `packages/api/src/routers/export.ts`
    - `packages/api/src/lib/reports.ts`
    - `packages/api/src/lib/gst-register-rows.ts`
    - `docs/specs/accounting-core.md`
  - Interfaces: `reportTooLarge(limit)` unchanged. The probe is one helper in
    `lib/reports.ts`, extracted only if two shapes share it.

- [ ] **S5: File cursor row comparison**
  - Acceptance:
    - `file.list` deep page: Index Cond on `file_org_created_idx` with a row
      comparison, under 5 ms at 180 k files. That needs a synthetic fill in a
      rolled-back transaction, or the plan shape on real data.
    - Paging across equal `created_at` values stays complete and ordered.
  - Verify: `EXPLAIN (ANALYZE)`; `bun run test` (`files`).
  - Depends on: none
  - Owns/Touches: `packages/api/src/routers/file.ts` (cursor predicate only)
  - Interfaces: `file.list` input and output unchanged.

- [ ] **S6: Pool timeout; cookie cache**
  - Acceptance:
    - `connectionTimeoutMillis` is set.
    - A starved pool raises an error instead of waiting forever: prove it with
      a local script that holds every connection.
    - The cookie cache is removed if decision 10's check holds; otherwise it
      stays, and the reason goes in the registry.
    - Sign-in, sign-out, org switch and an expired session still work in the
      running app.
  - Verify: `bun run test` (`auth-integrity`, `request-lifecycle`); a manual session
    check in the dev app.
  - Depends on: none
  - Owns/Touches: `packages/db/src/index.ts`, `packages/auth/src/index.ts`
  - Interfaces: none.

- [ ] **S7: Close out**
  - Acceptance:
    - Registry rows updated with the before and after numbers from S1–S6.
    - Accounting-core's "Period-close balance snapshot" entry cites the TB/P&L/BS
      numbers above as current evidence, with its gate unchanged.
    - Every item under Explicitly Deferred appears in the accounting-core Deferred
      list, or in this spec, with its gate.
  - Verify: `bunx oxfmt --check docs/`
  - Depends on: S2–S6
  - Owns/Touches: `docs/README.md`, `docs/specs/accounting-core.md`, this spec
  - Interfaces: none.

## Out of Scope

- A search engine, `tsvector` ranking, fuzzy or typo-tolerant matching.
- Changing register ordering (keyset on `id`) or page sizes.
- Index or config tuning of PostgreSQL itself, such as `shared_buffers` or `work_mem`.
- The UI loading pattern: the report routes keep their non-blocking loader and
  `ListState`, with no skeletons (design §9).

## Explicitly Deferred

- **Stored balances per account and period** (the period-close snapshot). TB/P&L/BS
  take about 0.4 s at 2.2 M lines and grow with history. Gate unchanged: a
  statement misses p95 100 ms at a real organization's volume.
- **Counter-sale number-series lock.** A counter sale holds it through every receipt
  (`invoice.ts` 359–383). Gate: measured posting p95 over budget with concurrent
  counter sales in one organization.
- **Journal posting loops per party.** One insert, lock and balance read per party.
  Gate: a real journal with more than 20 parties.
- **Streaming XLSX.** 100 k rows cost about 400 MB RSS. Gate: concurrent large
  exports on the production host.
- **Day book PDF on a busy day, and a fast day book refusal.** It fails at 5,000
  lines; the Meridian fixture has 18,214 lines per day. A month's XLSX takes 1.7–4.3 s
  to refuse. Gate: a real organization's single day over the limit.
- **GST and TDS register row bound.** No cap today. Gate: the first organization with
  taxable volume, or the streaming XLSX gate.
- **Date-range register filters under UUIDv7 ids.** The draft `OR` defeats the date
  index, and an old range will walk newer rows. Gate: measured on v7-id data.
- **`status = open/overdue` on mostly paid history**, and the open-items walk past
  paid documents. Gate: measured on a mostly paid fixture.
- **Day book summary over a full year** (1–4.7 s). The default range is one day.
  Gate: a user-reported need for wide ranges.
- **Prepared statements**, which would save about 1 ms of planning. Not worth the
  API surface.

## Open Questions

None. The database reset in S2 needs the owner's confirmation at run time.
