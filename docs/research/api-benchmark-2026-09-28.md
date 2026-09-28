# API benchmark, before and after: Meridian Traders, 2026-09-28

Every API read and write, before and after the query-performance work, on the same
data. Each response was checked before it counted (`scripts/benchmark-rpc.ts`).
Decisions: [Query performance](../specs/query-performance.md).

## Setup

- **Data:** one copy of the dev database, Meridian Traders with 1,000,000
  documents (UUIDv7-shaped ids, dates rising through the financial year), about
  2.2 million journal lines. Local Docker PostgreSQL 18, `shared_buffers` 128 MB.
- **Before:** `main` at `14d4494`, its API against `accly_before`, a
  byte-for-byte copy converted to `main`'s schema: no `search_text`, party index
  `(org_id, party_id)`, narrow ledger indexes, the three unique indexes back.
- **After:** this branch against the dev database in its final schema.
- **Runs:** both APIs `NODE_ENV=production` on one machine, one run at a time. Reads:
  20 timed calls after 5 warm-up calls; writes: 20 after 3. The client keeps
  cookies like a browser. Same inputs on both sides: small party
  `01a0e833-593a-7800-820e-946ec540049f`, busy party `01a0e833-593a-7839-bbc6-01e00077ea4f`, old number
  `RCT26-27/549`, common name `Tirupati`, other term
  `Meera`, period 2025-09-29 to 2026-09-28.
- **Checks:** 100 reads and 14 writes passed their response checks on both sides.
  Before and after returned the same answers except that journals are empty
  (the mega seed writes none).
- **Rechecks:** the session, settings and master reads looked 0.3–0.7 ms slower
  in the main run; 200 alternating calls per side measured them equal (1.6–2.8
  ms). Five posting types, 3 alternating rounds of 50: equal within noise except
  `payment_post_advance`, 7.4–7.9 → 8.4–9.8 ms p50, about 1.5 ms more, likely
  the search index on the newly numbered document.

## Results (ms)

### Search (register and palette)

| Scenario                           | Route             | Before p50 | After p50 | Before p95 | After p95 | Change      |
| ---------------------------------- | ----------------- | ---------: | --------: | ---------: | --------: | ----------- |
| `invoices_search_number`           | invoices          |       1069 |         6 |     1089.5 |       6.6 | 178× faster |
| `invoices_search_fragment`         | invoices          |      858.5 |       7.6 |      887.2 |       8.4 | 113× faster |
| `invoices_search_prefix`           | invoices          |        5.7 |       4.4 |        7.4 |       5.9 | same        |
| `invoices_search_name`             | invoices          |          4 |       5.1 |        4.6 |       5.5 | same        |
| `invoices_search_miss`             | invoices          |     1033.5 |       6.7 |     1063.1 |       8.1 | 154× faster |
| `invoices_search_other_org`        | invoices          |       10.1 |      41.1 |       11.3 |      48.4 | 4.1× slower |
| `bills_search_number`              | bills             |      707.3 |       7.5 |      783.2 |       8.3 | 94× faster  |
| `bills_search_fragment`            | bills             |      480.7 |      10.3 |      497.7 |      11.6 | 47× faster  |
| `bills_search_prefix`              | bills             |        3.8 |         5 |        4.5 |       5.8 | same        |
| `bills_search_name`                | bills             |       25.9 |       5.5 |       28.4 |       5.7 | 4.7× faster |
| `bills_search_miss`                | bills             |      696.4 |       6.9 |      755.8 |       9.2 | 101× faster |
| `bills_search_other_org`           | bills             |      664.1 |      24.1 |      697.5 |      27.7 | 28× faster  |
| `receipts_search_number`           | receipts          |      668.8 |       5.7 |      717.9 |       7.9 | 117× faster |
| `receipts_search_fragment`         | receipts          |      443.9 |       7.8 |      473.1 |       9.2 | 57× faster  |
| `receipts_search_prefix`           | receipts          |        3.2 |       4.4 |        3.7 |       6.4 | same        |
| `receipts_search_name`             | receipts          |       13.9 |       2.7 |       22.1 |       3.3 | 5.1× faster |
| `receipts_search_miss`             | receipts          |        671 |       5.3 |      727.1 |       6.3 | 127× faster |
| `receipts_search_other_org`        | receipts          |        8.5 |      26.9 |          9 |      27.7 | 3.2× slower |
| `payments_search_number`           | payments          |      566.6 |       5.7 |      611.9 |       6.5 | 99× faster  |
| `payments_search_fragment`         | payments          |      336.7 |         7 |      361.3 |       8.5 | 48× faster  |
| `payments_search_prefix`           | payments          |      532.3 |       3.4 |        595 |       4.2 | 157× faster |
| `payments_search_name`             | payments          |         12 |       3.9 |       13.4 |       4.3 | 3.1× faster |
| `payments_search_miss`             | payments          |      589.3 |       5.4 |     1056.4 |       8.7 | 109× faster |
| `payments_search_other_org`        | payments          |      529.4 |      21.6 |       1136 |        22 | 25× faster  |
| `notes_search_number`              | notes             |      156.1 |       8.8 |      166.7 |      10.5 | 18× faster  |
| `notes_search_fragment`            | notes             |      897.5 |      11.3 |      970.3 |      13.7 | 79× faster  |
| `notes_search_prefix`              | notes             |      884.5 |       9.6 |      949.1 |      10.9 | 92× faster  |
| `notes_search_name`                | notes             |        156 |       7.8 |        163 |       8.7 | 20× faster  |
| `notes_search_miss`                | notes             |      150.6 |       8.3 |      152.8 |       9.1 | 18× faster  |
| `notes_search_other_org`           | notes             |         50 |      23.1 |       53.7 |      24.4 | 2.2× faster |
| `receipts_search_old_number_found` | receipts, palette |      659.3 |       5.8 |        680 |         7 | 114× faster |
| `journals_search_miss`             | journals          |        2.7 |       2.3 |        4.1 |       3.2 | same        |

### Party filters and pages

| Scenario                   | Route    | Before p50 | After p50 | Before p95 | After p95 | Change      |
| -------------------------- | -------- | ---------: | --------: | ---------: | --------: | ----------- |
| `invoices_first_page`      | invoices |        4.1 |       3.3 |        7.9 |       4.1 | same        |
| `invoices_second_page`     | invoices |        4.7 |       3.4 |        5.8 |       4.4 | same        |
| `invoices_party_small`     | invoices |        4.7 |       3.4 |        5.4 |         4 | same        |
| `bills_first_page`         | bills    |          4 |       4.1 |        4.9 |       5.5 | same        |
| `bills_second_page`        | bills    |        5.7 |       3.4 |        8.5 |       4.2 | 1.7× faster |
| `bills_party_small`        | bills    |      315.8 |       8.3 |      328.6 |      10.4 | 38× faster  |
| `receipts_first_page`      | receipts |        2.2 |       2.7 |        2.8 |       2.9 | same        |
| `receipts_second_page`     | receipts |        2.7 |       2.8 |        3.6 |       3.1 | same        |
| `receipts_party_small`     | receipts |          2 |       2.7 |        2.2 |       3.4 | same        |
| `payments_first_page`      | payments |        2.3 |         2 |        3.6 |       3.2 | same        |
| `payments_second_page`     | payments |          2 |       1.8 |        2.8 |       2.9 | same        |
| `payments_party_small`     | payments |      291.6 |       5.5 |        327 |       7.5 | 53× faster  |
| `notes_first_page`         | notes    |        5.7 |       4.2 |        6.8 |       4.6 | same        |
| `notes_second_page`        | notes    |        9.2 |       4.2 |       11.4 |       5.4 | 2.2× faster |
| `notes_party_small`        | notes    |       12.5 |       3.8 |       13.2 |         4 | 3.3× faster |
| `invoices_status_open`     | invoices |        5.9 |       4.7 |        7.1 |       5.9 | same        |
| `invoices_status_overdue`  | invoices |       25.6 |      19.6 |       27.8 |      20.2 | 1.3× faster |
| `receipts_state_cancelled` | receipts |          3 |       2.8 |        4.6 |       3.4 | same        |
| `journals_first_page`      | journals |        2.8 |       2.4 |        4.1 |       2.7 | same        |

### Balances and party tabs

| Scenario                       | Route                    | Before p50 | After p50 | Before p95 | After p95 | Change      |
| ------------------------------ | ------------------------ | ---------: | --------: | ---------: | --------: | ----------- |
| `party_list`                   | parties                  |        2.6 |       3.4 |        3.7 |       4.7 | same        |
| `party_list_search`            | parties                  |        1.9 |       2.1 |          2 |       2.4 | same        |
| `money_balances`               | home, banking            |      368.4 |      87.1 |      409.3 |        94 | 4.2× faster |
| `party_balances`               | home, parties            |       85.6 |      39.8 |       90.4 |      41.6 | 2.2× faster |
| `receipt_party_totals`         | parties/$id              |       13.6 |      13.6 |       14.2 |      14.4 | same        |
| `party_get`                    | parties/$id              |        2.3 |       1.7 |        2.6 |       2.3 | same        |
| `party_ledger_summary`         | parties/$id              |          6 |       4.3 |        6.8 |       5.1 | same        |
| `party_ledger_lines`           | parties/$id/ledger       |          3 |       3.5 |        3.4 |       4.5 | same        |
| `party_transactions_busy`      | parties/$id/transactions |        2.4 |       2.6 |        2.8 |       4.2 | same        |
| `party_transactions_small`     | parties/$id/transactions |        2.4 |       2.6 |        2.8 |       3.7 | same        |
| `party_open_items`             | receipts/new             |      477.6 |     168.4 |      514.1 |     181.9 | 2.8× faster |
| `party_open_credits`           | receipts/new             |        498 |      64.9 |      509.1 |      74.9 | 7.7× faster |
| `party_statement_small`        | parties/$id (PDF)        |         18 |      19.9 |       20.6 |      22.2 | same        |
| `party_statement_busy_refusal` | parties/$id (PDF)        |       34.1 |       2.8 |       44.8 |       3.3 | 12× faster  |

### Reports and day book

| Scenario                     | Route                        | Before p50 | After p50 | Before p95 | After p95 | Change      |
| ---------------------------- | ---------------------------- | ---------: | --------: | ---------: | --------: | ----------- |
| `trial_balance`              | reports/trial-balance        |      357.6 |     306.4 |      400.6 |     416.2 | same        |
| `profit_and_loss`            | reports/profit-and-loss      |        318 |     302.5 |      436.8 |       319 | same        |
| `balance_sheet`              | reports/balance-sheet        |      341.1 |     317.3 |      469.5 |     321.3 | same        |
| `account_ledger_summary`     | reports/account-ledger       |      202.1 |      37.1 |      233.8 |      38.8 | 5.4× faster |
| `account_ledger_lines`       | reports/account-ledger       |        5.2 |       3.5 |        8.6 |       4.8 | same        |
| `account_ledger_pdf_refusal` | reports/account-ledger (PDF) |       47.9 |       4.1 |       86.4 |       4.4 | 12× faster  |
| `day_book_summary_today`     | reports/day-book             |       10.5 |       4.6 |       11.2 |       5.5 | 2.3× faster |
| `day_book_entries_today`     | reports/day-book             |        6.2 |       6.1 |        9.3 |       6.8 | same        |
| `day_book_month_summary`     | reports/day-book             |        155 |      43.7 |      173.8 |      48.4 | 3.5× faster |

### Exports and refusals

| Scenario                        | Route          | Before p50 | After p50 | Before p95 | After p95 | Change      |
| ------------------------------- | -------------- | ---------: | --------: | ---------: | --------: | ----------- |
| `export_trial_balance`          | reports (XLSX) |      348.8 |     323.5 |      395.8 |     345.9 | same        |
| `export_profit_and_loss`        | reports (XLSX) |      348.1 |     322.7 |      398.9 |     336.1 | same        |
| `export_balance_sheet`          | reports (XLSX) |      356.2 |     335.3 |      376.2 |     345.3 | same        |
| `export_party_statement_small`  | parties (XLSX) |       20.9 |      20.4 |       25.1 |      24.1 | same        |
| `export_account_ledger_refusal` | reports (XLSX) |     2566.5 |      10.3 |     6925.5 |      11.5 | 249× faster |
| `export_party_statement_busy`   | parties (XLSX) |      158.2 |     164.2 |        173 |     171.8 | same        |
| `export_gst_outward_month`      | reports (XLSX) |       56.7 |      55.5 |       61.3 |        61 | same        |
| `export_gst_inward_month`       | reports (XLSX) |         19 |      15.3 |       21.8 |      18.5 | same        |
| `export_tds_month`              | reports (XLSX) |        3.3 |       2.2 |        4.6 |       2.4 | same        |

### Document views

| Scenario        | Route          | Before p50 | After p50 | Before p95 | After p95 | Change      |
| --------------- | -------------- | ---------: | --------: | ---------: | --------: | ----------- |
| `settings_get`  | settings       |        1.6 |       2.1 |        1.8 |       2.4 | same        |
| `lock_get`      | settings/locks |        1.8 |       2.2 |        2.1 |       2.6 | same        |
| `invoice_get`   | invoices/$id   |        6.4 |       6.1 |        8.3 |       7.8 | same        |
| `bill_get`      | bills/$id      |        6.7 |       4.8 |       10.1 |       6.6 | same        |
| `receipt_get`   | receipts/$id   |        4.2 |       2.2 |        5.3 |       3.3 | 1.9× faster |
| `payment_get`   | payments/$id   |        4.5 |       2.7 |          6 |       3.2 | same        |
| `note_get`      | notes/$id      |        4.3 |       3.1 |        5.2 |         4 | same        |
| `journal_get`   | journals/$id   |          4 |       2.7 |          5 |       3.3 | same        |
| `invoice_quote` | invoices/new   |        4.3 |       3.7 |          6 |       6.6 | same        |

### Session, settings and masters

| Scenario              | Route            | Before p50 | After p50 | Before p95 | After p95 | Change |
| --------------------- | ---------------- | ---------: | --------: | ---------: | --------: | ------ |
| `member_me`           | layout           |        1.9 |       2.5 |        3.3 |       3.9 | same   |
| `member_list`         | settings/members |        1.8 |       2.2 |        2.3 |       2.8 | same   |
| `audit_list`          | settings/audit   |        1.9 |       2.6 |        3.5 |       3.2 | same   |
| `file_list`           | settings/files   |        1.5 |       1.8 |        2.2 |         2 | same   |
| `account_list`        | accounts         |        1.9 |       2.1 |        3.1 |       2.6 | same   |
| `item_list`           | items            |          2 |       2.6 |        3.5 |       3.6 | same   |
| `payment_method_list` | banking          |        1.6 |       1.9 |          2 |       3.1 | same   |
| `journal_accounts`    | journals/new     |        2.5 |       2.6 |        2.9 |       3.5 | same   |

### Writes

| Scenario                | Route             | Before p50 | After p50 | Before p95 | After p95 | Change      |
| ----------------------- | ----------------- | ---------: | --------: | ---------: | --------: | ----------- |
| `party_create`          | parties           |        4.7 |       3.2 |        5.1 |       4.4 | same        |
| `party_update`          | parties           |        4.1 |       3.1 |        4.9 |       4.3 | same        |
| `item_create`           | items             |        4.9 |         4 |        5.6 |       4.8 | same        |
| `invoice_draft_insert`  | invoices/new      |        5.7 |       6.1 |        6.7 |       7.1 | same        |
| `invoice_draft_update`  | invoices/$id/edit |          6 |       5.8 |        7.7 |       8.5 | same        |
| `invoice_draft_discard` | invoices/$id/edit |        2.3 |         2 |        2.8 |       3.8 | same        |
| `invoice_post`          | invoices/new      |        8.9 |       9.9 |       10.6 |      11.8 | same        |
| `invoice_cancel`        | invoices/$id      |        9.5 |       8.9 |       15.2 |      11.9 | same        |
| `receipt_post_advance`  | receipts/new      |        9.9 |       8.5 |       18.1 |      11.8 | same        |
| `allocation_apply`      | receipts/$id      |        7.5 |         7 |        9.2 |       9.5 | same        |
| `bill_post`             | bills/new         |        8.7 |        11 |       14.4 |      12.7 | same        |
| `payment_post_advance`  | payments/new      |        7.8 |      10.4 |       11.2 |      14.8 | 1.3× slower |
| `credit_note_post`      | notes/new         |       16.8 |      12.9 |       20.5 |      32.4 | 1.3× faster |
| `journal_post`          | journals/new      |          7 |       6.7 |       14.1 |        11 | same        |

## Not in this table

- **Session reads.** Measured separately through `/rpc`: with the cache cookie
  expired, one request reads the `session` table once and returns a renewed
  cookie; the next five requests read it 0 times. Before, the renewed cookie was
  dropped, so every request after the first 5 minutes of a sign-in read the
  `session` table.
- **Pool.** With all 10 connections held, a request fails after 5,006 ms instead
  of waiting without limit.

## Known trade-offs

- A term common in this organization but sparse among its newest 1,000
  documents (`Meera` in invoices and receipts) takes 27–41 ms instead of 9–10
  ms: the page does not fill from the window, so the trigram index is read.
- Statements (trial balance, P&L, balance sheet and their XLSX) stay at about
  300 ms: stored balances were measured against the workload and rejected; see
  [TigerBeetle architecture](./tigerbeetle-architecture-2026-09-28.md).
