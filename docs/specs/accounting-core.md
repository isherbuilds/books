# Spec: Accounting core

Status: ready
Authority: founder's 2026-09-08 brainstorm and the request to design the core fresh, without bias toward the current domain code; research in [docs/research/ledger-architecture.md](../research/ledger-architecture.md); validation packet [docs/validation/ca-first-ledger.md](../validation/ca-first-ledger.md).
Supersedes: the billing, charge, outpatient and customer domain described in `docs/product.md` and `docs/architecture.md` (those docs are updated in slice 7). The tenant, auth, request, audit, file and storage spine is kept unchanged.

## Problem

An owner with several legal entities (a school trust, a hospital company, personal rental income) keeps books in tools that are either fast but local and fragile (Tally), or cloud but slow and priced per entity (Zoho). Corrections silently rewrite history, the CA gets backups over WhatsApp, and every entity is a separate world. Operational systems (a hospital desk, a school office, a point of sale) already produce invoices and receipts that must land in the books without re-entry.

## Solution

A sector-agnostic accounting core where documents are the only write model and the ledger is derived, append-only and reversal-only. One Organization is one legal entity; the owner and the CA are members of several. Every mutation is a named, idempotent command recorded in a command log, so the same core can later be driven from an offline client. Tax and posting rules are dated data. Periods lock with scoped, audited exceptions. Reports and exports (PDF, Excel) come straight from the ledger in the CA's format. Documents can be created by a person or posted by an external system.

## Validation / Evidence

Owner-funded pilot on the founder's three entities, reviewed by the founder's CA. External demand is unproved (packet status `framed`, verdict `insufficient evidence`). Baseline: Tally on a local machine for entry, Excel and WhatsApp for handover. Target outcomes recorded in the packet: receipt entry within 10 percent of Tally keystroke time (client spec), month-end handover as exports the CA accepts without rework, zero in-place edits of posted documents. Adoption constraint: opening balances and masters import from Excel; Tally XML import is a later spec.

## User Stories / Scenarios

1. As an owner, I want each legal entity to be its own Organization with its own PAN, GSTIN, financial year and chart of accounts, so that tax identity never mixes.
2. As an accountant, I want to record money received (Receipt) against a party in one form, so that the receipt is numbered, printed and posted in one step.
3. As an accountant, I want to record money paid (Payment) with TDS deducted where a section applies, so that the vendor ledger and the TDS register are correct without a second tool.
4. As an accountant, I want to raise an Invoice or record a Bill with items, HSN or SAC and GST computed from the dated rate schedule and place of supply, so that the document prints as Tax Invoice or Bill of Supply correctly.
5. As an accountant, I want a Credit Note or Debit Note to correct an issued document, so that no posted document is ever edited.
6. As an accountant, I want to cancel a posted document and see a reversing entry, so that the ledger shows what happened and when.
7. As a CA, I want to lock a period after filing and grant a named person a time-boxed exception with a reason, so that back-dated entries cannot break a filed return.
8. As a CA, I want trial balance, account ledger, party statement, day book, P&L, balance sheet, GST outward and inward registers and the TDS register as Excel and PDF, so that filing and audit need nothing else.
9. As an owner, I want opening balances and masters imported from Excel, so that cutover from Tally takes a morning.
10. As an operational system (hospital desk, school office, POS), I want to post a finalized invoice or receipt with my own reference, so that a repost is ignored and the books stay in step.
11. As an agent or integration, I want a documented read model and change feed, so that I can answer questions about the books without touching the ledger.

## Implementation Decisions

Canonical language (use exactly these words in code, navigation and docs):

- **Organization**: one legal entity. Profile: `legalType` (individual, proprietorship, partnership, llp, company, trust, society), `pan`, `gstin` (nullable), `stateCode`, `financialYearStart` (April), `timeZone`. Replaces the notion "one business".
- **Site**: an operating location inside an Organization that owns document number series. One default Site per Organization in this spec.
- **Party**: any counterparty (customer, vendor, tenant, donor, employee, government). Role flags, optional `gstin` and `pan`, address with `stateCode` for place of supply. Replaces Customer and Payer.
- **Account**: a node in the chart of accounts. `type` asset, liability, equity, income, expense; `parentId`; optional `systemKey`. Seeded per `legalType` from templates.
- **Item**: a thing sold or bought. `hsnSac`, `unit`, `taxClass` (taxable, exempt, nil, nonGst), default price.
- **Document**: the write model. Types: Receipt, Payment, Invoice, Bill, CreditNote, DebitNote, Journal, OpeningBalance. States: `draft`, `posted`, `cancelled`. A posted or cancelled document never changes. Header carries `number`, `series`, `documentDate`, `partyId`, `siteId`, `source` (`user` or a named system), `externalRef`, `version`, totals in paise, and a tax snapshot. Lines carry `kind` (item, account, tax, tds, roundOff), amounts in paise, and the id of the tax rate row applied.
- **Journal Entry and Journal Line**: the derived ledger. Entry: `documentId`, `documentType`, `kind` (`post` or `reverse`), `reversesEntryId`, `entryDate`, `postedAt`, `narration`. Line: `accountId`, optional `partyId`, `debitPaise`, `creditPaise`. Append-only.
- **Party Ledger Line** and **Allocation**: receivable or payable exposure per document, and the append-only allocation of one document against another. Outstanding is document amount minus allocations.
- **Balance**: one row per Organization, Account and month with cumulative debit and credit in paise and a `version`, updated inside the posting transaction.
- **Posting Rule**: data row that maps (`documentType`, `lineKind`, `taxClass`, `legalType` or null) to debit and credit account `systemKey`s, with `priority`, `effectiveFrom`, `effectiveTo`.
- **Tax Rate Row**: (`taxType` gst, `hsnSac` or class, `cgst`, `sgst`, `igst`, `cess` in basis points, `effectiveFrom`, `effectiveTo`). Rows are archived by end date, never edited.
- **TDS Section Row**: (`section`, `rateBasisPoints`, `thresholdPaise`, `effectiveFrom`, `effectiveTo`, `newSectionCode` for the Income-tax Act 2025 renumbering).
- **Number Series**: (`orgId`, `siteId`, `documentType`, `financialYear`, `prefix`, `next`). Assigned at post, row-locked. A new financial year starts a new row.
- **Period Lock**: per Organization, `kind` general or tax, `lockedThrough` date, `setBy`, `reason`. **Lock Exception**: `userId` or `accountId`, date range, `reason`, `grantedBy`, `expiresAt`.
- **Command**: a named, idempotent mutation. Log row: client-generated `id` (UUIDv7), `orgId`, `name`, `actorUserId`, `deviceId`, `deviceSeq`, `payload` (jsonb), `payloadDigest`, `status`, `resultRef`, `createdAt`. Unique on (`orgId`, `id`). A replay with the same id and digest returns the stored result; a different digest is rejected.

Architecture calls:

1. **Documents first, ledger derived, append-only.** Posting a document writes the document state change, journal entry and lines, party ledger lines, balances and the number series update in one Postgres transaction. Cancellation writes a `reverse` entry dated at cancellation and flips the document to `cancelled`; nothing else changes. The app database role has no UPDATE or DELETE on `journal_entries`, `journal_lines`, `party_ledger_lines`, `allocations`, `commands`. A deferred constraint trigger rejects an entry whose debits and credits differ. See ADR 0001.
2. **Money is `bigint` paise** in every table and in all arithmetic; decimal strings appear only at the API boundary. No `numeric` money columns.
3. **Commands are the only write path.** Each command is one `orgProcedure(permission, input)` per the tenancy rule, and every command procedure delegates to one core `executeCommand(scope, command, handler)` that records the log row, enforces idempotency, runs the handler in the transaction, and stores the result. Reads are separate query procedures. This keeps the raw builder unexported and the permission explicit, and gives offline replay one shape.
4. **Posting rules and tax rules are data**, seeded by migration, selected by priority and effective date at post time. A document line stores the rule row and rate row ids it used. Nothing about GST rates or account mapping lives in code paths.
5. **Supply type** is intra-state when the Organization `stateCode` equals the place of supply, else inter-state; place of supply defaults to the Party address state. An Organization without a `gstin` posts no tax lines and prints Bill of Supply or plain Receipt.
6. **Document classification for print** follows the item tax classes: all exempt or nil lines print Bill of Supply; any taxable line prints Tax Invoice; a Receipt prints Receipt. The CA-approved printed fields are data on the Organization profile, not code.
7. **Back-dating**: a document dated on or before the general lock is refused unless a matching Lock Exception exists; a tax-affecting document dated on or before the tax lock is refused likewise. Before a lock, back-dating posts synchronously and balances for later months are updated in the same transaction. No queued reposting.
8. **External posting**: a document with `source` other than `user` must carry `externalRef`; unique (`orgId`, `source`, `externalRef`) makes a repost a no-op that returns the existing document. The HTTP ingestion endpoint and API keys are a later spec; the columns, constraint and command exist now.
9. **Reports** read Balances and Journal Lines only. P&L and balance sheet are driven by a **Statement Definition** table (statement, line order, label, account type or `systemKey` set, sign) so the CA's format is data. Trial balance, account ledger, party statement and day book are direct queries. Exports render on the server: PDF through the existing renderer, XLSX through one workbook writer.
10. **Roles** in `packages/auth/src/access.ts`: `owner` (everything), `accountant` (parties, items, documents, reports, exports), `ca` (reports, exports, locks, exceptions, read documents), `operator` (create and post Receipt, Payment, Invoice; read parties and items). Permission statements: `party`, `item`, `document`, `journal` (manual), `lock`, `report`, `export`, `settings`, `member`, `audit`, `file`.
11. **Audit** stays fire-and-forget for sensitive actions: post, cancel, lock, exception grant, member change. Field-level history of drafts is not audited; posted documents do not change.
12. **Migrations**: no live financial document exists, so the migration history is regenerated once from the new schema (`bun run db:generate` after the schema rewrite), and becomes append-only from slice 2 onward.
13. **Time**: `documentDate` and `entryDate` are calendar dates in the Organization time zone; `postedAt` is an instant. Financial year is derived from `documentDate` and `financialYearStart`.

Modules:

- `packages/db/src/schema/`: new tables listed above; the outpatient, charge, practitioner, department, payer and customer tables are deleted in slice 7.
- `packages/api/src/core/`: `money.ts`, `commands.ts` (`executeCommand`), `posting.ts` (rule resolution and line generation, pure), `tax.ts` (rate lookup and supply type, pure), `numbering.ts`, `locks.ts`, `balances.ts`, `party-ledger.ts`.
- `packages/api/src/routers/`: `organization.ts`, `party.ts`, `item.ts`, `receipt.ts`, `payment.ts`, `invoice.ts`, `bill.ts`, `note.ts`, `journal.ts`, `lock.ts`, `report.ts`, `export.ts`, `import.ts`.
- `packages/auth/src/access.ts`: roles and statements above.
- `apps/web`: a thin form per document type to exercise the path in the running app; keyboard-first entry, local master cache and speed work are the client spec (`docs/specs/keyboard-first-entry.md`, not yet written).

## Test Seams

- **Router client over `orgProcedure`** (`tests/support/client.ts`, prior art `tests/integration/accounting.test.ts`, `tenancy.test.ts`): every story is proved by calling command and query procedures as a member of one Organization and asserting on query results, exports and rejections. Cross-tenant attempts assert `NOT_FOUND` or `FORBIDDEN` per the tenancy test pattern.
- **Pure core functions** (`tests/unit/`, prior art `access.test.ts`): `posting.ts` and `tax.ts` take rules and rates as arguments and return lines; tested without a database for rule priority, effective dates, supply type, rounding, and classification.
- **Database guards** (integration): a direct UPDATE on `journal_lines` under the app role fails; an unbalanced entry fails at commit.
- **Export bytes** (integration, prior art `billing-pdf-fixture.ts`): PDF and XLSX responses parsed and asserted for numbers and labels, never snapshot whole files.

## Task Plan

- [ ] Slice 1: Spine reset, Organization profile, Party, Account templates, money, command log
  - Acceptance: creating an Organization with `legalType` seeds its chart from the template and a default Site; a Party can be created with roles and a `stateCode`; `executeCommand` records a log row, returns the same result on replay with the same id and digest, and rejects the same id with a different digest with `CONFLICT`; all money columns are `bigint`; migrations regenerated once and applied clean on an empty database.
  - Verify: `bun run check-types`, `bun run test` (new `tests/integration/core.test.ts` for org seed, party, command replay, cross-tenant rejection), `bun run dev:status` green.
  - Depends on: none
  - Owns/Touches: `packages/db/src/schema/{organization-profile,sites,parties,accounts,commands}.ts`, `packages/db/drizzle/`, `packages/api/src/core/{money,commands}.ts`, `packages/api/src/routers/{organization,party}.ts`, `packages/auth/src/access.ts` (coordinator-owned, shared), `tests/integration/core.test.ts`.
  - Interfaces: `executeCommand(scope, { id, name, deviceId, deviceSeq, payload }, handler: (tx, payload) => Promise<Result>) => Promise<Result>`; `Money` as `bigint` paise with `parseMoney(string)` and `formatMoney(bigint)`; `organization.create`, `organization.getProfile`, `party.create`, `party.update`, `party.list` procedures.

- [ ] Slice 2: Receipt end to end (proof slice for the posting pattern)
  - Acceptance: `receipt.post` with party, amount, method and reference assigns the next number from the Site series for the financial year, writes one balanced journal entry (cash or bank debit, party receivable or income credit per posting rule), a party ledger line, updates the month Balance row, and returns the document; `receipt.cancel` writes a reverse entry dated today and the document reads `cancelled`; a direct UPDATE on `journal_lines` under the app role fails; an unbalanced entry cannot commit; the receipt PDF shows number, party, amount in words, method, reference; day book XLSX for the date lists it. Speed baseline: with 100,000 journal lines in one Organization seeded by `scripts/seed-volume.ts`, `receipt.post` server time p95 under 30 ms over 200 posts measured by the test harness timer on the developer machine; record the number in this spec.
  - Verify: `bun run test` (`tests/integration/receipt.test.ts`, `tests/unit/posting.test.ts`), and the receipt form in the running app on desktop and mobile widths in both themes.
  - Depends on: Slice 1
  - Owns/Touches: `packages/db/src/schema/{documents,document-lines,journal-entries,journal-lines,party-ledger-lines,allocations,balances,posting-rules,number-series}.ts`, `packages/api/src/core/{posting,numbering,balances,party-ledger}.ts`, `packages/api/src/routers/{receipt,export}.ts`, `apps/web/src/routes/$orgSlug/receipts/`, `tests/integration/receipt.test.ts`, `tests/unit/posting.test.ts`.
  - Interfaces: `resolvePostingLines(rules, document, lines) => JournalLineInput[]` (pure); `postDocument(tx, scope, document) => { entryId, number }`; `reverseDocument(tx, scope, documentId, reason)`; `receipt.create`, `receipt.post`, `receipt.cancel`, `receipt.get`, `receipt.list`, `export.documentPdf`, `export.dayBookXlsx`.

- [ ] Slice 3: Payment with TDS and vendor allocation
  - Acceptance: `payment.post` records money out against a party or an expense account; a TDS line with a section from the TDS table reduces the amount paid and credits the TDS payable account; allocation against open Bills or Debit Notes reduces the party outstanding; the TDS register XLSX lists section, party PAN, gross, TDS, net for a date range; a section row past its `effectiveTo` is not selectable.
  - Verify: `bun run test` (`tests/integration/payment.test.ts`, TDS cases in `tests/unit/posting.test.ts`).
  - Depends on: Slice 2
  - Owns/Touches: `packages/db/src/schema/tds-sections.ts`, `packages/api/src/routers/payment.ts`, `packages/api/src/core/posting.ts` (extend), export writer additions, `tests/integration/payment.test.ts`.
  - Interfaces: `payment.create`, `payment.post`, `payment.cancel`, `payment.allocate`; `export.tdsRegisterXlsx`.

- [ ] Slice 4: Invoice, Bill, Items, GST engine, Credit and Debit Notes
  - Acceptance: an Invoice with items computes CGST and SGST for intra-state and IGST for inter-state from the rate row effective on the document date, stores the rate row id per line, rounds per document to the paise with a round-off line, and prints Tax Invoice or Bill of Supply by classification; an unregistered Organization posts no tax lines; a Bill mirrors this for purchases with input tax accounts; a Credit Note against an Invoice reverses tax and reduces the receivable through an allocation; the number series restarts on 1 April; GST outward and inward register XLSX exports match the GSTR-1 and purchase register columns (document number, date, party GSTIN, place of supply, taxable value, rate, tax split); a rate row change with a new `effectiveFrom` changes new documents only.
  - Verify: `bun run test` (`tests/integration/invoice.test.ts`, `tests/integration/bill.test.ts`, `tests/unit/tax.test.ts`), invoice form in the running app both themes.
  - Depends on: Slice 2
  - Owns/Touches: `packages/db/src/schema/{items,tax-rates}.ts`, `packages/api/src/core/tax.ts`, `packages/api/src/routers/{item,invoice,bill,note}.ts`, PDF templates, `apps/web/src/routes/$orgSlug/invoices/`, tests named above.
  - Interfaces: `computeTax(rates, orgProfile, party, lines, documentDate) => TaxedLine[]` (pure); `invoice.*`, `bill.*`, `note.*`, `item.*`; `export.gstOutwardXlsx`, `export.gstInwardXlsx`.

- [ ] Slice 5: Manual Journal, Opening Balances, Period Locks and Exceptions
  - Acceptance: a Journal document posts arbitrary balanced lines and rejects unbalanced input; OpeningBalance posts once per Organization and financial year against the opening equity account; setting a general lock refuses posting or cancelling any document dated on or before it with `LOCKED`; a tax lock refuses only documents with tax lines; a Lock Exception for a user and date range allows exactly that user and range and expires; every lock and exception is audited; back-dating before the lock updates later month Balances in the same transaction and a trial balance at a later date agrees with the sum of lines.
  - Verify: `bun run test` (`tests/integration/locks.test.ts`, `tests/integration/journal.test.ts`).
  - Depends on: Slice 2
  - Owns/Touches: `packages/db/src/schema/{period-locks,lock-exceptions}.ts`, `packages/api/src/core/locks.ts`, `packages/api/src/routers/{journal,lock}.ts`, tests named above.
  - Interfaces: `assertUnlocked(tx, scope, documentDate, affectsTax, actorUserId)`; `lock.set`, `lock.grantException`, `lock.list`; `journal.*`; `openingBalance.post`.

- [ ] Slice 6: Reports and exports in the CA's format
  - Acceptance: trial balance, account ledger, party statement, day book, P&L and balance sheet as JSON, XLSX and PDF for any date range; P&L and balance sheet lines come from Statement Definitions seeded per `legalType`; the trial balance totals agree with Balances and with a direct sum over Journal Lines for the same range; the `ca` role can read and export but cannot post; with 100,000 journal lines a one-year trial balance responds in under 100 ms server time p95 (same harness as slice 2).
  - Verify: `bun run test` (`tests/integration/reports.test.ts`), exports opened in a spreadsheet and a PDF viewer once.
  - Depends on: Slices 3, 4, 5
  - Owns/Touches: `packages/db/src/schema/statement-definitions.ts`, `packages/api/src/routers/{report,export}.ts`, `apps/web/src/routes/$orgSlug/reports/`, `tests/integration/reports.test.ts`.
  - Interfaces: `report.trialBalance`, `report.ledger`, `report.partyStatement`, `report.dayBook`, `report.profitAndLoss`, `report.balanceSheet`; `export.reportXlsx`, `export.reportPdf`.

- [ ] Slice 7: Excel import, external posting, retire the old domain, update docs
  - Acceptance: masters (parties, items, accounts) and opening balances import from one Excel template with row-level errors returned and nothing written on any error; a Receipt or Invoice posted with `source` and `externalRef` twice yields one document and the second call returns it; the outpatient, charge, practitioner, department, payer, customer and legacy billing tables, routers, routes and tests are deleted; `docs/product.md`, `docs/architecture.md`, `docs/README.md` registry and `apps/fumadocs` describe the new domain; `CONTEXT.md` glossary matches the canonical language above.
  - Verify: `bun run check-types`, `bun run check`, `bun run test`, `bun run --cwd apps/fumadocs build`, `bunx oxfmt --check` on changed Markdown.
  - Depends on: Slice 6
  - Owns/Touches: `packages/api/src/routers/import.ts`, deletions across `packages/db/src/schema`, `packages/api/src/routers`, `apps/web/src/routes/$orgSlug`, `tests/integration`, and the docs listed (coordinator-owned).
  - Interfaces: `import.masters`, `import.openingBalances`; `source` and `externalRef` on every document command.

## Out of Scope

Keyboard-first client, local master cache and offline sync (client spec, then a sync spec); GST return JSON, Tally XML and Zoho CSV exports; direct filing through a GSP; e-invoicing IRN and e-way bill; IMS; bank statement import and reconciliation; TDS return e-filing (26Q); payroll; inventory valuation; multi-currency; the HTTP ingestion endpoint and API keys; the agent read model and change feed (columns and reports exist; the curated view and feed are a later spec); MSME 43B(h) ageing (needs Udyam fields on Party, later spec).

## Explicitly Deferred

- Hash chain per Organization and journal: columns `previousHash` and `hash` are not added now; the append-only role guard is the audit control in this spec.
- Chart of accounts and Statement Definition templates ship as drafts for the CA to approve in the pilot; approval is a pilot gate, not a code change.
- TDS section rows are seeded from the current schedule with the 2025 Act renumbering column; the CA verifies the seed before the first Payment with TDS.
- Partitioning of `journal_lines` and `balances` by Organization and financial year waits until a table exceeds ten million rows.
- Per-Site number series exists but only the default Site is created; multiple Sites arrive with the sync spec.
- Speed targets in slices 2 and 6 are server-side; the user-visible target (within 10 percent of Tally keystroke time) is measured in the client spec.

## Open Questions

None. Decisions the CA may overturn in the pilot (templates, printed fields, TDS seed) are listed under Explicitly Deferred with their gate.
