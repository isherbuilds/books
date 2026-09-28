# TigerBeetle architecture and benchmarks, 2026-09-28

## Question

Is TigerBeetle's architecture valid? Are its benchmarks meaningful? Which parts
of it, if any, should Accly Books adopt for performance?

Source tree: `github.com/tigerbeetle/tigerbeetle` at commit
`47aeb2212a255273dda508288412e537d11e4b7c` (2026-08-31). File references below
use that commit.

## Answer

- **The architecture is valid for its target.** Jepsen found safety bugs, and
  TigerBeetle fixed them. Jepsen concluded that version 0.16.30 "appeared to meet
  its promise of Strong Serializability". The design is sound engineering, not
  marketing.
- **The headline benchmark does not measure our problem.** It measures write
  throughput of full 8,190-transfer batches on one node, with no reads other
  than a per-account transfer list. It does not measure period reports, SQL,
  multi-tenant scope, or single-document latency. Independent tests put the gap
  over well-built PostgreSQL at 2.8x, not 1000x.
- **The speed comes from one idea that we cannot copy into PostgreSQL:** run
  all ledger logic inside one single-threaded engine, in large batches, so no
  row locks exist. Stored running balances are cheap there only because nothing
  else writes to the account row at the same time.
- **Our bottleneck is not the one TigerBeetle solves.** We post tens to hundreds
  of documents per hour per org at 4–17 ms each. TigerBeetle targets thousands
  to millions of transfers per second on hot accounts. Our slow paths are period
  reports (~300 ms), and TigerBeetle offers no period report at all.
- **Already have:** immutable append-only postings, reversals instead of
  deletes, and a debits-equal-credits check inside the posting transaction.
- **Reject:** running TigerBeetle beside PostgreSQL; synchronous stored balance
  rows in PostgreSQL; write batching; static allocation.
- **Defer with a gate:** deterministic simulation testing of the posting core;
  engine-enforced balance limits (for example, no negative cash).
- **Licence is not a blocker.** TigerBeetle is Apache-2.0. Apache-2.0 code may
  go into a GPLv3 or AGPLv3 work. Ideas carry no licence at all.

## Evidence

### Licence

- `LICENSE` lines 1–3: "Apache License Version 2.0, January 2004".
- The FSF lists Apache-2.0 as compatible with GPLv3
  (https://www.gnu.org/licenses/license-list.html#apache2). AGPLv3 §13 allows
  combination with GPLv3 works. Copied code must keep the Apache NOTICE and
  attribution.

### Architecture

- **Single thread, logic in the database.** `docs/concepts/performance.md:15`:
  "all the logic lives inside the database, obviating the need for locking."
  `docs/ARCHITECTURE.md:168-186`: TigerBeetle is single-threaded because "the
  underlying workload is inherently contentious… Transfers between hot accounts
  inherently sequentialize the system." `performance.md:56`: adding nodes
  increases reliability, "but not throughput."
- **Consensus.** `docs/ARCHITECTURE.md:29-52`: a six-replica cluster uses
  Viewstamped Replication. The primary appends each batch ("prepare") to a
  hash-chained write-ahead log. Replicas apply committed prepares with a
  deterministic function, so they reach the same state.
- **Storage.** `docs/ARCHITECTURE.md:56-67`: state is a forest of LSM trees.
  Past transfers are kept for idempotency.
- **Batching.** `docs/concepts/performance.md:27`: "up to 8,190 transfers per
  query"; replication cost "is paid only once per batch."
  `docs/ARCHITECTURE.md:364-374`: batching also applies to disk writes (32
  prepares) and checkpoints (1,024 prepares).
- **Static allocation and determinism.** `docs/TIGER_STYLE.md:151`: "All memory
  must be statically allocated at startup." `docs/ARCHITECTURE.md:281-306`:
  determinism gives byte-identical replicas and reproducible test failures.

### How a transfer changes balances

- `src/state_machine.zig:3706-3960` (`create_transfer`): the engine loads both
  accounts, checks ledger, closed flags, and overflow, then checks limits
  (`:3890-3891`). It inserts the transfer and adds the amount to
  `debits_posted` / `credits_posted` on the two account rows (`:3915-3924`).
- `src/tigerbeetle.zig:34-42`: `debits_must_not_exceed_credits` rejects a
  transfer when pending plus posted debits plus the amount exceed posted
  credits.
- A transfer has exactly one debit and one credit account. A multi-line entry
  is a chain of transfers with `flags.linked`; the chain applies or fails as a
  whole (`src/state_machine.zig:3183-3190`;
  `docs/coding/recipes/multi-debit-credit-transfers.md:12-29`).
- History: every transfer writes an `account_events` row with both accounts'
  balances after the transfer (`src/state_machine.zig:4406-4435`). It is
  indexed per account only when `flags.history` is set (`:4440-4454`).
  `get_account_balances` returns nothing otherwise
  (`docs/reference/requests/get_account_balances.md:5`).
- Transfers "cannot be modified" or deleted; corrections are new transfers
  (`docs/reference/transfer.md:15-29`).

### What TigerBeetle is not

- `docs/coding/system-architecture.md:4`: TigerBeetle "is not a general purpose
  database like PostgreSQL or MySQL. Instead, TigerBeetle works alongside your
  general purpose database."
- `system-architecture.md:55`: "initiating a transfer should not require
  fetching metadata from the general purpose database."
- `system-architecture.md:69`: "TigerBeetle does not support authentication."
- Queries: `get_account_transfers`, `get_account_balances`, `query_accounts`,
  `query_transfers`. Filters are equality on `user_data_*` and `code`, plus a
  range on the TigerBeetle timestamp. Results are capped by message size and
  must be paged (`docs/reference/account-filter.md`,
  `docs/reference/requests/query_transfers.md:16-18`). There is no aggregate,
  sum, group-by, or join.
- Timestamps come from the cluster clock. Imported (backdated) transfers must
  still be "strictly increasing" (`docs/reference/transfer.md:495`). The
  business date belongs in `user_data_64` (`docs/coding/data-modeling.md:142`),
  which is not range-queryable.

### Benchmark method

- `src/tigerbeetle/benchmark_driver.zig:8-10, 115-128`: with no addresses given,
  the benchmark formats a temporary **single-node** cluster
  (`--replica-count=1`).
- `src/tigerbeetle/cli.zig:138-161` defaults: 10,000 accounts, **0 hot
  accounts**, **uniform** account choice, 10,000,000 transfers, maximum batch
  size, 1 client. The CLI itself calls uniform "unrealistic workloads"
  (`cli.zig:614`).
- `src/tigerbeetle/benchmark_load.zig:1-21`: it outputs "throughput and
  latency", and default numbers "are not necessarily comparable across
  different TigerBeetle versions." Latency is reported per **batch**
  (`:583-600`), not per transfer.
- The only read phase is 100 `get_account_transfers` calls on accounts drawn
  uniformly by default (hot accounts when configured)
  (`:604-640`).
- Homepage claims: "1000x Faster OLTP", "100K-500K TPS", "90% Contention", and
  that SQL databases cap at "≈100–1,000 TPS" under contention
  (https://tigerbeetle.com/). `docs/concepts/oltp.md:73`: "designed to handle
  1 million transactions per second."

### Independent checks

- Jepsen, TigerBeetle 0.16.11–0.16.30, 2025-06-06
  (https://jepsen.io/analyses/tigerbeetle-0.16.11). Found: missing query
  results with multi-predicate queries (safety, fixed 0.16.17); a single-node
  failure raised latency "three to five orders of magnitude", from under 1 ms to
  about 10 s (fixed 0.16.43); upgrade divergence (documented only); clients
  retry forever, so "everything becomes a timeout."
- SoftwareMill, MacBook M1 Max, single node, Zipfian accounts: TigerBeetle 42k
  TPS; PostgreSQL batched 15k TPS; PostgreSQL explicit locking 6.4k TPS. "2.8
  times faster than the best competing PostgreSQL implementation"
  (https://softwaremill.com/tigerbeetle-vs-postgresql-performance-benchmark-setup-local-tests/).
- CYBERTEC, TPC-B with 10% hot-row contention: interactive SQL with 10 ms
  network delay reached 431 tx/s; moving logic into a stored procedure with
  batching gave more than 10x that
  (https://www.cybertec-postgresql.com/en/reconsidering-the-interface/).
- VOPR: the whole cluster runs under simulated network, disk, and clock faults,
  "24/7 on 1024 cores" (`docs/concepts/safety.md:107-111`;
  `docs/internals/vopr.md`).

## What this proves / does not prove

Proves:

- TigerBeetle's consensus and state machine hold strict serializability under
  faults, after the Jepsen fixes.
- A single-threaded, batched, in-database ledger beats row-locked SQL on write
  throughput under contention. The measured gap is 2.8x to 7x, not 1000x.
- The main loss for SQL is interactive transactions that hold locks across a
  network round trip. CYBERTEC shows PostgreSQL recovers most of the gap when
  the logic runs server-side.

Does not prove:

- Anything about period reports, trial balance over a date range, or
  statements. TigerBeetle has no such query. Inference: a trial balance for a
  past date needs one `get_account_balances` call per account, with `history`
  on, and a mapping from business date to cluster timestamp that TigerBeetle
  does not keep.
- Anything about single-document latency at low load. The benchmark reports
  per-batch latency at full batches.
- Anything about multi-tenant scope, authentication, GST documents, or number
  series. TigerBeetle has none of these.
- The "1000x" figure. No source at this commit shows the method behind it.
  Inference: it compares ideal batching against PostgreSQL with network-held
  locks at high contention.

## What this means for us

| TigerBeetle idea                                        | Accly today                                                                                  | Would it help at our numbers?                                                                                                                                                                                 | Cost and risk                                                                                                                                                                                                                                                      | Verdict                                                                                                       |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| (a) Stored running balances, updated with each transfer | Balances summed on read: cash 89 ms, party 42 ms, reports ~300 ms                            | Little. Reports run a few times a day and are under 0.5 s.                                                                                                                                                    | In PostgreSQL this adds a hot row per account behind row locks — the exact contention TigerBeetle avoids by having no locks. Our earlier deadlock finding (number-series lock vs balance lock) applies. Two copies of the ledger can drift.                        | **Reject** (already rejected twice)                                                                           |
| (b) Single-threaded serial execution, no row locks      | One PostgreSQL transaction per posting, one `number_series` row lock                         | No. Lock waits appear only when two postings of one type in one org overlap in the same 7–15 ms. At hundreds per hour this is rare.                                                                           | A per-org serial queue adds a new process, a failure mode, and a queue to operate.                                                                                                                                                                                 | **Reject**                                                                                                    |
| (c) Batching writes                                     | One document per request                                                                     | No. Users post one document at a time and wait for its number. Batching raises latency to gain throughput we do not need.                                                                                     | Delayed numbering, partial-batch error handling.                                                                                                                                                                                                                   | **Reject** (bulk import may batch inside one transaction if import becomes slow)                              |
| (d) Double-entry invariants in the engine               | `assertBalanced` inside the posting transaction (`packages/api/src/core/posting.ts:573-591`) | Balanced entries: already covered. Balance limits (for example, no negative cash): not built.                                                                                                                 | A limit check needs the current balance, so it needs (a) or a sum inside the transaction.                                                                                                                                                                          | **Already have** (balance); **defer** limits until a customer asks                                            |
| (e) Immutable transfers, reversals as new transfers     | Cancellation posts reversing entries; no deletes                                             | Already the same model.                                                                                                                                                                                       | None.                                                                                                                                                                                                                                                              | **Already have**                                                                                              |
| (f) Deterministic simulation testing                    | Normal unit and integration tests                                                            | Partly. A seeded random generator of postings, cancellations, and allocations, checked against invariants (trial balance nets to zero, party balance equals the sum of open items), could find ordering bugs. | Moderate test code. Must obey the project testing rules (no new framework).                                                                                                                                                                                        | **Defer with gate**: adopt if a posting or allocation bug escapes to a real org, or before offline sync ships |
| (g) Static memory, no runtime allocation                | Bun/JavaScript with GC                                                                       | No. Our latency is SQL time, not GC pauses.                                                                                                                                                                   | Not possible in JavaScript in any useful form.                                                                                                                                                                                                                     | **Reject**                                                                                                    |
| (h) Run TigerBeetle beside PostgreSQL                   | PostgreSQL only                                                                              | No. Our writes take 4–17 ms at hundreds per hour. Our reports need date-range sums that TigerBeetle cannot answer.                                                                                            | A second system of record. Every posting must commit in two databases with no shared transaction ("write last, read first" rules). No auth, so a gateway is needed. A cluster to run and upgrade. GST documents, numbering, and tenancy stay in PostgreSQL anyway. | **Reject**                                                                                                    |

Inference: "follow TigerBeetle's design" for our reports would mean copying the
part that is fast because it has no locks, into a database that has locks. That
moves cost from reads, which are rare, to writes, which users wait on.

The useful lessons are general: keep ledger logic close to the data (we do: one
server-side transaction), keep entries immutable (we do), and measure with a
realistic workload (our 1,000,000-document benchmark does this).

## Next falsification

The verdicts change if one of these measurements appears:

- **Reads.** A real org's statement or trial balance p95 over 1 s on production
  hardware, or a report users open many times an hour. Then revisit a
  period-close snapshot (ERPNext "Account Closing Balance" style) first, not
  running balances.
- **Writes.** Sustained posting need above about 50 documents per second in
  one org (for example, a POS or API integration), or `number_series` lock wait
  p95 above 50 ms under real load. Then measure a batched import path, and only
  then reconsider (b) or (h).
- **Correctness.** A ledger bug found in production that a unit test did not
  catch. Then build (f).
- **Benchmarks.** A TigerBeetle benchmark that includes date-range aggregates
  with a business-date field. None exists at this commit.

## Sources

- TigerBeetle repository, commit `47aeb2212a255273dda508288412e537d11e4b7c`:
  `LICENSE`, `docs/ARCHITECTURE.md`, `docs/TIGER_STYLE.md`,
  `docs/concepts/{oltp,performance,safety}.md`,
  `docs/coding/{system-architecture,data-modeling}.md`,
  `docs/coding/recipes/multi-debit-credit-transfers.md`,
  `docs/reference/{transfer,account-filter,account-balance}.md`,
  `docs/reference/requests/{get_account_balances,query_transfers}.md`,
  `docs/internals/vopr.md`, `src/state_machine.zig`, `src/tigerbeetle.zig`,
  `src/tigerbeetle/{cli,benchmark_driver,benchmark_load}.zig`
- Jepsen, TigerBeetle 0.16.11: https://jepsen.io/analyses/tigerbeetle-0.16.11
- TigerBeetle homepage: https://tigerbeetle.com/
- TigerBeetle performance docs: https://docs.tigerbeetle.com/concepts/performance/
- SoftwareMill benchmark: https://softwaremill.com/tigerbeetle-vs-postgresql-performance-benchmark-setup-local-tests/
- CYBERTEC, "Reconsidering the interface": https://www.cybertec-postgresql.com/en/reconsidering-the-interface/
- FSF licence list (Apache-2.0): https://www.gnu.org/licenses/license-list.html#apache2
- ERPNext v15 Account Closing Balance: https://frappe.io/blog/product-updates/v15-erpnext-updates
