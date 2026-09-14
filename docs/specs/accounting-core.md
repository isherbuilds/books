# Spec: Accounting core

Status: slices 1–3 implemented; slices 4–7 open. Authority: the founder's
decisions. Git keeps the research behind them.

## Outcome

Documents are the only write model; the ledger is derived and reversal-only.
One Organization is one legal entity. Pilot targets: receipt entry within 10
percent of Tally ([H4](./client-patterns.md#speed-gate-h4)), a month-end the CA
accepts without rework, and no in-place edit of a posted document.

## Canonical language

Definitions are in [`CONTEXT.md`](../../CONTEXT.md). Contract details:

- **Organization** (`organization_settings`): `legalType` (individual,
  proprietorship, partnership, llp, company, trust, society), `pan`, optional
  `gstin`, `stateCode` and `financialYearStart`.
- **Party**: role flags (descriptive only), optional `gstin` and `pan`, and an
  address `stateCode`. `party.update` replaces all fields, with the loaded
  `updatedAt` as its token.
- **Account**: `type`, `parentId` and an optional `systemKey`. Income accounts
  carry `supplyClass` (`taxable`, `exempt`, `nil`, `nonGst`, `notASupply`).
  Interest is `exempt`; `notASupply` covers donations, grants, dividends,
  capital receipts and insurance claims.
- **Money account** and **Payment Method**: see
  [Architecture](../architecture.md#money-accounts).
- **Document** header: `number`, `series`, `financialYear`, `documentDate`,
  `partyId`, `exposureSide`, `settlementKind`, `advanceSupply`,
  `paymentMethodId`, `reference`, `source`, `version` (draft token),
  `totalPaise`, `affectsTax`, and a print snapshot that reprints read alone.
  Slice 4 adds `dueDate`, `placeOfSupplyStateCode` and `amendedFrom`. A Journal
  leaves the party, method and settlement fields null.
- **Exposure Side** (`receivable`, `payable` or null) is the control that a
  document settles, not the cash direction. A customer refund is a
  `receivable` Payment.
- **Party Ledger Line**: exposure per document, party and side, positive when
  the Party owes the Organization.
- **TDS Section**: a Form 140 `code` (Income-tax Act 2025), `rateBasisPoints`,
  `effectiveFrom` and an inclusive `effectiveTo`. Rows are never edited. The
  database refuses a duplicate (org, code, start); the writer keeps ranges
  apart. **TDS Deduction**: one `tds_deductions` row per Payment, kept when it
  rounds to zero.

## Architecture calls

1. **Documents first, append-only**
   ([Architecture](../architecture.md#documents-first-append-only)). A post
   entry reverses once. There is one `DATABASE_URL`, and Organization deletion
   is unreachable.
2. **Money** follows [Development](../development.md#code-rules). Fractional
   prices or FX need a precision contract before slice 4.
3. **One `orgProcedure` per mutation**, in one transaction. Reads are separate.
4. **Posting in code, accounts and rates in data**
   ([Architecture](../architecture.md#posting-mechanics-in-code-accounts-and-rates-in-data)).
   A line stores the tax rate row it used. Bank charges and write-offs are
   account lines.
5. **Supply type** is intra-state when the Organization `stateCode` equals the
   document's stored place of supply. `computeTax` takes it explicitly. No
   `gstin` means no tax lines.
6. **Print class**: all exempt or nil lines print Bill of Supply, any taxable
   line prints Tax Invoice, and a Receipt prints Receipt. Printed fields are
   data that the CA approves.
7. **Locks.** From slice 5, posting or cancelling on or before the general lock needs an
   exception. The tax lock follows `affectsTax`, stored at post, which marks any
   document in a GST register, exempt direct Receipts included. Cancellation
   checks both dates. Back-dating before a lock rewrites nothing.
8. **External posting is post-MVP.** References, digests, deduplication,
   ingestion and API keys arrive together.
9. **Reports.** Accounting reports read journal lines. P&L and balance sheet
   come from Statement Definitions. Each report states its range, and
   `unclosed` until period close exists.
10. **Roles.** `owner`: everything. `accountant`: masters, every document,
    allocations, reports, exports. `ca`: reads everything, exports, sets locks
    and exceptions, never posts. `operator`: creates and posts Receipt, Payment
    and Invoice, reads masters, prints; never cancels, allocates, creates
    masters or exports. Grants are per document type and action (`read`,
    `create`, `post`, `cancel`), plus `allocation` `apply` and `reverse`.
11. **Audit** follows [Architecture](../architecture.md#audit-and-files).
12. **Migrations** follow [Development](../development.md#code-rules).
13. **Time.** `documentDate` and `entryDate` are dates in the Organization time
    zone; `postedAt` is an instant. The financial year derives from
    `documentDate`.
14. **Three layers.** Operations (a hospital desk, a school office) lives
    outside this repository and calls Billing's document procedures. Billing
    (`documents.ts`, `numbering.ts`, `party-ledger.ts`) owns parties, methods,
    documents, series, the party ledger and allocations. General Accounting
    (`posting.ts`) owns accounts, posting functions, journal entries,
    accounting reports and locks. Every document, the manual Journal included,
    is Billing and enters General Accounting only through `recordEntry`;
    General Accounting never writes Billing rows.
15. **Report classes.** Billing reports read documents, the party ledger and
    allocations (statements, outstanding, registers, GST registers). Accounting
    reports read journal lines (day book, ledger, trial balance, P&L, balance
    sheet). One report never mixes both.
16. **Receipt settlement.** The user picks the kind; nothing is inferred. From
    slice 4, a Receipt with allocations is `against` and one without is
    `advance`; `direct` stays explicit.

    | Kind      | Money for                    | Debit          | Credit                    | Also                         |
    | --------- | ---------------------------- | -------------- | ------------------------- | ---------------------------- |
    | `against` | Open Invoices or Debit Notes | Method account | `receivables`, party      | Allocations; rest is advance |
    | `advance` | A claim not yet raised       | Method account | `customerAdvances`, party | A party ledger line          |
    | `direct`  | Income with no claim         | Method account | The income Account        | Nothing                      |

    A Receipt never computes tax. With a `gstin`, a `direct` Receipt to a
    `taxable` account is refused (`TAXABLE_DIRECT_RECEIPT`). `exempt`, `nil`
    and `nonGst` accounts feed the register's exempt table; `notASupply` stays
    out. An `advance` stores `advanceSupply`: `goods` (no GST, Notification
    66/2017), `exempt`, or `taxableService`, which is refused
    (`ADVANCE_TAX_UNSUPPORTED`) until GST advance documents exist. The database
    checks only that `advanceSupply` is present exactly on `advance` Receipts
    (`documents_advance_supply_check`); the app validates the values. From
    slice 4, a mixed `against` Receipt stores it for its remainder, and slice 4
    widens that check. The allocations made at post fix the kind; a later
    `allocation.apply` never changes it. Applying an advance posts Dr
    `customerAdvances` / Cr `receivables`, or Dr `payables` / Cr
    `supplierAdvances`. A note-to-invoice allocation posts nothing. Payment
    mirrors all this; its `direct` kind posts to an expense or asset.

17. **Settlement changes.** From slice 4, a document with active allocations refuses
    cancellation (`CONFLICT` naming them); reverse them first. Receipt and
    Payment cancellation reverses allocations and entry together. Post,
    allocate and cancel lock the affected documents in ascending id order,
    recheck, and retry if the set changed. Allocation changes are dated today,
    check the general lock on all three dates, and skip the tax lock.
18. **Due dates.** From slice 4, a posted Invoice or Bill derives `settlementStatus` (`paid`,
    `partPaid`, `unpaid`) and an `overdue` flag from outstanding and `dueDate`.

## Slices

Each open slice lists the deleted outpatient billing code that solved a similar
problem. Git keeps it at `a716b6c`. Read it; do not copy it.

1. **Spine, Party, templates, money.** Implemented: the settings row, chart
   templates, Parties with a namesake check and one GSTIN per Organization (an
   application check, `PARTY_GSTIN_TAKEN`), master lists complete to 5,000
   rows then `MASTER_LIST_LIMIT`, money accounts and methods.
2. **Receipt.** Implemented: `receipt.post` (full payload, no draft), `get`,
   `list`, `partyTotals`, `cancel`, the day book XLSX, and the snapshot PDF at
   `/api/$orgSlug/receipts/$receiptId/pdf`. `against` waits for slice 4. Open:
   CA acceptance, and posting p95 under 30 ms on native PostgreSQL at 100,000
   lines (`db:seed:volume`, 100,000 receipts per organization).
3. **Payment with TDS.** Implemented: `payment.*`, `tdsSections({ date })` and
   the TDS register XLSX. TDS is the amount times the rate, half-up to the
   rupee, at the earlier of credit or payment. A Party without a PAN is refused.
   The register reads the PAN from the snapshot, and a Form 140 correction fixes
   a filed quarter. No web form yet. Open: the CA verifies the 13-row seed.
4. **Invoice, Bill, Items, GST, notes, allocations.** Open. A post takes
   `mode: "new"`, or `mode: "draft"` with a `version` (stale is `CONFLICT`). A
   pure `computeTax` reads the dated rate and the stored place of supply and
   rounds per document. Bills carry `itcEligible` and line TDS at credit.
   Receipts gain `against`, fee and write-off lines, and customer TDS to
   `tdsReceivable`. A counter sale is an Invoice marked paid. A correction is
   cancel-and-copy (`amendedFrom`). GST registers match the GSTR-1 columns.
   `postDocument` takes the header fields and a lines array; Receipt and
   Payment pass one line. The Journal reuses this. Invoices and Credit Notes
   number from the `invoicePrefix` and `creditNotePrefix` settings.
   - Legacy reference (a716b6c):
     - Half-up division: `divideHalfUp`
       (`a716b6c:packages/api/src/core/money.ts:45-58`) returns with
       `computeTax`. Legacy rounded per line; this slice rounds per document.
     - Header discount: split pro rata, half-up, with the residue on the
       largest line, so lines sum to the header; the same method makes line
       tax sum to the document tax
       (`a716b6c:packages/api/src/lib/invoice-math.ts:35-106`).
     - Rates are integer basis points, like `tds_sections.rateBasisPoints`,
       never the legacy money text
       (`a716b6c:packages/api/src/lib/invoice-math.ts:71-78`).
     - Store the GST split once: `computeTax` stores CGST, SGST and IGST on the
       lines, and print and registers read them. The legacy PDF split again and
       disagreed with the register on negative tax
       (`a716b6c:packages/api/src/lib/invoice-math.ts:114-119`,
       `a716b6c:apps/web/src/components/pdf/billing-documents.tsx:311-343`).
     - Credit Note bounds: work back from gross, bound each line per component
       (taxable, tax, gross) against earlier credits, and bound the total by the
       Invoice. A refund needs two bounds: the note total and the negative
       outstanding (`a716b6c:packages/api/src/routers/billing.ts:632-953`).
     - Zero lines: drop a zero line before `recordEntry`
       (`journal_lines_one_side_check` refuses 0/0) and refuse an empty entry
       (`a716b6c:packages/api/src/lib/ledger.ts:176-204`).
     - Revenue lines: one credit per revenue account; legacy skipped the entry
       for a zero-total Invoice. Decide between no entry and a refusal
       (`a716b6c:packages/api/src/routers/billing.ts:297-324`).
     - Version token plus expected total: put `version` in the conditional
       `UPDATE`, and compare the recomputed total too, because a dated rate
       change moves the total without a version bump
       (`a716b6c:packages/api/src/routers/billing.ts:411-467`).
     - Allocation locks: sort the source and target ids, lock them in one
       `where id in (…) order by id for update`, then recheck (call 17). Legacy
       locked one Invoice
       (`a716b6c:packages/api/src/routers/billing.ts:98-115`, `:342-409`).
       `.for("update", { of: table })` locks the document and leaves the joined
       Party free (`a716b6c:packages/api/src/routers/billing.ts:140-162`).
     - Counter sale numbering: number the Invoice and the Receipt last, in a
       fixed type order, so two series locks never deadlock
       (`a716b6c:packages/db/src/counter.ts:8-26`).
     - Masters: one org- and active-scoped `inArray` query per master type,
       then `NOT_FOUND` for any unresolved id; copy item facts (name, price,
       rate row, tax code) onto the line at write
       (`a716b6c:packages/api/src/lib/opd-charges.ts:17-168`).
     - Outstanding for a list: select the `limit + 1` page first, then
       aggregate for those ids in one grouped query with the org predicate in
       each branch (`a716b6c:packages/api/src/lib/invoice-balance.ts:16-75`).
       The formula becomes `totalPaise` minus active allocations to the
       document.
     - Lists by `documentDate`: a row-value keyset
       `(document_date, id) < ($1, $2)` on an index
       `(org_id, type, document_date, id)`; `documents_org_type_date_idx` has
       no `id` (`a716b6c:packages/api/src/routers/customer.ts:232-340`).
     - GST register: groups lines by document, rate and HSN, negates notes and
       reads the stored date. It was intra-state only; extend it with IGST,
       place of supply and the B2B and B2CS split
       (`a716b6c:packages/api/src/lib/report-math.ts:190-383`).
     - Item price history in audit metadata
       (`a716b6c:packages/api/src/routers/item.ts:115-211`): decide whether a
       price edit is a sensitive action.
     - Avoid: a correlated per-row subquery filtered in `WHERE`
       (`a716b6c:packages/api/src/routers/billing-worklist.ts:26-39`); a read
       that writes (`a716b6c:packages/api/src/lib/opd-close.ts:31-82`);
       `regexp_replace` in `WHERE`, which no index serves
       (`a716b6c:packages/api/src/lib/phone.ts:1-3`); `Promise.all` inside a
       transaction, where node-postgres queues the reads on one client
       (`a716b6c:packages/api/src/routers/billing.ts:653-696`).
5. **Journal, Opening Balance, locks.** Open. The contract is
   [Journal (slice 5)](#journal-slice-5). General and tax locks (`LOCKED`) and
   expiring user exceptions, all audited.
   - Legacy reference (a716b6c):
     - Attachments, when the CA asks: lock the parent `FOR UPDATE` and the file
       row `FOR KEY SHARE`, so `file.delete` waits; a duplicate insert returns
       `CONFLICT` (`a716b6c:packages/api/src/routers/opd.ts:933-1003`).
6. **Reports.** Open. Trial balance, ledger, party statement, day book, P&L and
   balance sheet in JSON, XLSX and PDF. The trial balance equals a direct sum.
   One year runs in p95 under 100 ms at 100,000 lines.
   - Legacy reference (a716b6c):
     - Trial balance: two grouped aggregates over journal lines (opening before
       `from`, activity in the period), opening netted into Dr or Cr, all-zero
       rows dropped, sorted by code. Return bigint, not decimal strings
       (`a716b6c:packages/api/src/routers/report.ts:75-128`,
       `a716b6c:packages/api/src/lib/report-math.ts:27-134`).
     - Summaries: one scan with `count(*) filter (where …)` and `sum(case …)`
       returns several figures, such as outstanding and overdue
       (`a716b6c:packages/api/src/routers/billing-worklist.ts:113-122`).
     - Period bound: `maxDays` applies only to reports whose row count grows
       with the period (`a716b6c:packages/api/src/routers/report.ts:41-73`).
     - Party statement: check the Party is in scope in parallel with the lines,
       so a foreign id is `NOT_FOUND`, not an empty statement
       (`a716b6c:packages/api/src/routers/customer.ts:54-66`).
     - Browser print, only if it stays beside the server PDF: print CSS that
       isolates `[data-report-print]` and forces light tokens
       (`a716b6c:apps/web/src/lib/report-presentation.ts:20-54`).
     - Charts: the rules were Design §11 (`a716b6c:docs/design.md:378-391`); a
       trend gap-fills in SQL with `generate_series`
       (`a716b6c:packages/api/src/routers/dashboard.ts:96-110`).
7. **Import.** Open. One Excel template imports masters, opening balances and
   opening items (open documents with `source` `opening`, original due dates,
   no journal lines of their own, summing to each Party's balance), all or
   nothing.

## Journal (slice 5)

The contract for the first manual Journal (journal voucher). Nothing is built.
Today's code needs only additive changes.

- **Document.** Type `journal`, a Billing document like Receipt, posted in full
  with no draft. Header: `documentDate`, a required `narration` (1–500), an
  optional `reference` (120), and `totalPaise` as the debit total. Party,
  method, settlement fields and the print snapshot stay null.
- **Lines.** 2 to 100. Each has `accountId`, `side` (`debit` or `credit`),
  `amountPaise` above 0, an optional `partyId` (attribution only) and an
  optional `description`. At least one debit and one credit; the totals are
  equal. The router refuses bad input as `BAD_REQUEST` before the core.
- **Accounts.** Any active leaf, money leaves included. Refused: groups, the
  party control accounts (`receivables`, `payables`, `customerAdvances`,
  `supplierAdvances`), GST input, output and cess accounts, and `taxable` income
  when the Organization has a `gstin` (the call 16 guard). So `affectsTax` is
  false and the Journal writes no party ledger lines. A new batch predicate,
  `journalAccounts`, sits beside `postableAccount` in `lib/accounts.ts` and
  reuses `isLeaf`; `postableAccount` does not change.
- **Storage.** One migration adds nullable `entry_side` (`debit`, `credit`) and
  `party_id` (composite key to `parties`) to `document_lines`. `amount_paise`
  stays positive. The ledger derives from these lines.
- **Posting.** `JournalPosting { type: "journal", amountPaise, lines }` joins
  `DocumentPosting`. A pure `postJournal` checks the lines, `recordEntry`'s
  dispatch becomes a switch, and `assertBalanced` also refuses an empty entry.
- **Write path and number.** The slice 4 `postDocument`. A `journalPrefix`
  setting (default `JV`, the `documentPrefix` rule, a database default for
  existing rows) gives `JV26-27/1`.
- **Cancel.** `reverseDocument` as it is: once, with a reason, dated the cancel
  day. A wrong date is fixed by a new Journal, not by editing.
- **Contra** is a label for a Journal whose lines are all money leaves (bank to
  bank, a cash deposit). One type, one series.
- **Wiring.** `journal.{post,get,list,cancel}` with their own get and list (not
  `settlementDetail`), the tenancy guarded-call table, a nav entry with
  `journal: ["read"]`, audit on post and cancel, and a ledger label. Grants
  already exist. The day book and `account.moneyBalances` already read journal
  entries.
- **Opening Balance.** One per Organization (a partial unique index on posted
  `openingBalance`), dated the cutover, balanced to `openingEquity`, with a
  fixed `OB` prefix. It uses the Journal lines and account rule, so party
  balances come only from the slice 7 opening items, never twice.
- **Locks.** A `lock.set` procedure and a lock table, not `settings.update`
  (the CA cannot call it, and it replaces every field). `postDocument` and
  `reverseDocument` read the lock inside their transaction.

| Not in the first Journal                              | Gate                                                                                                  |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Party lines on control accounts, bill-wise references | Slice 4 allocations and a CA example (set-off, bad-debt write-off); then side follows the account key |
| GST accounts and line tax                             | The monthly GST-on-fee reclass gate                                                                   |
| Drafts and approval                                   | Slice 4 drafts proven; more posters than reviewers                                                    |
| Recurring, templates, auto-reversal                   | One Journal posted three months running, or a CA accrual workflow                                     |
| A Contra series or a Transfer document                | The CA asks, or bank reconciliation opens                                                             |
| Multi-currency, inter-company                         | Their own spec; two live Organizations for one owner                                                  |
| Print, attachments, cost centres                      | The CA asks, or a pilot report needs one                                                              |

## Deferred

- **Card and gateway clearing accounts**, with payout Journals that book MDR
  plus GST net. Gate: the slice 5 Journal, and an accountant who wants bank
  balances exact to the day. A "Card Clearing" leaf under Bank Accounts
  (`account.create`) needs no code. A separate clearing group needs a backfill,
  because every `systemKey` is required when a document posts.
- **Monthly GST-on-fee reclass.** Gate: the slice 5 Journal and a CA who claims
  the input credit. For exempt hospital or school supplies, GST on fees is a
  cost.
- **Gateways, bank reconciliation, mandatory bank references, bank details on
  invoices.** Gate: the [Product](../product.md#scope) evidence gates.
- **Period-close balance snapshot** (like ERPNext's Account Closing Balance).
  Gate: a trial balance or ledger misses its latency budget at pilot volume.
- **Partitioning `journal_lines`.** Gate: ten million rows.
- **TDS thresholds, amount overrides and the no-PAN rate** (§397(2)). Gate: the
  slice 4 Bill spec, or the first pilot case.
- **TDS schedule updates for existing Organizations.** Gate: the first statute
  change after pilot data exists.
- **Clearing TDS Payable** by Journal, on purpose: a Payment cannot name a
  system account. Gate: the first TDS deposit.
- **GST on taxable service advances** (tax at receipt, reversal, GSTR-1 tables
  11A and 11B). Gate: the first such advance, and CA verification.
- **Reverse charge.** Gate: before the first applicable Bill, build it or record
  a CA-approved manual process.
- **Bill of Supply for direct exempt Receipts.** Gate: the CA asks.
- **Receipt gaps**: refunds of unused advances, refundable deposits,
  third-party payers, `direct` to a non-income account. Gate: the CA answers
  the worked examples below.
- **GSTR-1 Table 13.** Gate: the slice 4 registers.
- **Account-scoped lock exceptions.** Gate: a CA states the rule.
- **Year-end close.** Gate: the first pilot year end.
- **Billing without General Accounting.** Gate: a hospital customer keeps
  Tally, or the hospital system joins this repository.
- **Patient-to-Party link.** Gate: one shared Billing interaction proved from
  the hospital side.
- **Owner summaries across Organizations.** Gate: two live Organizations for one
  owner.
- **Per-site number series.** Gate: a real multi-location workflow.
- **Journal hash chain.** Gate: an audit requirement for tamper evidence.
- **Restricted database role and RLS.** Gate: production hardening.
- **Command log and idempotent ingestion.** Gate: after the pilot.

Out of scope, each for its own spec: GST return JSON, Tally and Zoho exports,
GSP filing, e-invoice, e-way bill, IMS, TDS returns, payroll, inventory
valuation, multi-currency, MSME §37(2)(g) ageing and the agent read model.

## Open questions

1. **CA acceptance**, recorded here with name and date: the call 16 table; the
   13 TDS rows; half-up rupee TDS versus exact paise; the chart templates (the
   trust "Fees" account is `taxable`, the professional "Rent Received" is
   `exempt`); and these worked examples, tax excluded: a ₹10,000 advance with
   ₹4,000 applied to a ₹6,000 Invoice; a Credit Note refunded by Payment; a
   supplier Debit Note against a Bill; a Receipt shared by two Invoices, one
   allocation reversed, then cancelled; a cutover with open Invoices and an
   advance for one Party; a TPA settlement net of TDS with a disallowance; a
   dealer receipt net of TDS and a bank charge; a school caution deposit; an IPD
   deposit.
2. **Allocation reversal model** (blocks slice 4). Call 17 appends a reversal
   row, but `allocations` has a mutable `state` and `reversedAt`. Slice 4
   aligns them.
