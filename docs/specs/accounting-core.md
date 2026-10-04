# Spec: Accounting core

Status: slices 1–3, 4a, 4b-i, 4b-ii, 5 (Journal, Opening Balance, locks),
6 (reports, 6a–6d), 8 (chart of accounts) and 9 (party Journals, 9a and 9b)
are implemented. Slice 7 (import, 7a–7d) is open and specified; 7a, 7b and
7c are implemented;
remaining runtime and CA acceptance work is in the work registry.
Authority: the founder's decisions. `docs/research` and Git keep the evidence
behind them.

## Outcome

Documents are the only write model; the ledger is derived and reversal-only.
One Organization is one legal entity. Pilot targets: receipt entry within 10
percent of Tally ([H4](./client-patterns.md#speed-gate-h4)), a month-end the CA
accepts without rework, and no in-place edit of a posted document.

## Canonical language

Definitions are in [`CONTEXT.md`](../../CONTEXT.md). Contract details:

- **Organization** (`organization_settings`): `legalType` (individual,
  proprietorship, partnership, llp, company, trust, society), `pan`, optional
  `gstin`, `stateCode` and `financialYearStart`. The start month names every
  financial year and number series, so it is fixed once any document is
  numbered (`FINANCIAL_YEAR_FIXED`). `timeZone` is set at creation
  (`Asia/Kolkata` by default) and has no settings field: every Organization is
  Indian.
- **Party**: role flags (descriptive only), optional `gstin` and `pan`, and an
  address `stateCode`. Organization and Party forms use one multiline `address`
  field, with City and PIN code separate. `party.update` replaces all fields,
  with the loaded `updatedAt` as its token. With a GSTIN, the server derives `stateCode` and
  `pan` from it (characters 1–2 and 3–12); a state or PAN sent beside it must
  match. Forms show State and PAN only while GSTIN is empty. The
  Organization's own identity follows the same rule. Roles never gate a
  document, but pickers rank the document's role first (customer on Invoices
  and Receipts, vendor on Bills and payable Payments), and a party created
  inline from one starts with that role.
- **Account**: `type`, `parentId` and an optional `systemKey`. Income accounts
  carry `supplyClass` (`taxable`, `exempt`, `nil`, `nonGst`, `notASupply`).
  Interest is `exempt`; `notASupply` covers donations, grants, dividends,
  capital receipts and insurance claims. Templates seed the chart;
  `account.create` adds posting leaves at a type root or under an existing
  group, with generated codes. A user never creates, retypes or archives a
  system account, or converts a posting account into a group.
- **Item**: an Organization-unique `name` through `normalizedName`, optional
  `hsnSac` and `unit`, integer `unitPricePaise`, an income Account, and an
  `active` flag. The form never preselects the income Account: its supply class
  decides the tax treatment. `taxCode` is required exactly when the income Account is
  `taxable`.
- **Tax Rate**: `code`, `name`, an integer `rateBasisPoints` from 0 to 10,000,
  `effectiveFrom` and an inclusive `effectiveTo`. Rows are never edited, and
  `(Organization, code, effectiveFrom)` is unique. `seedTaxRates` gives each
  Organization GST5, GST12 and GST18 from 2017-07-01, GST28 until 2026-01-31,
  and GST40 from 2025-09-22. There is no GST0: the income Account's supply
  class decides nil and exempt supplies.
- **Money account** and **Payment Method**: see
  [Architecture](../architecture.md#money-accounts).
- **Document** header: `number`, `financialYear`, `documentDate`,
  `dueDate`, `placeOfSupplyStateCode`, `partyId`, `exposureSide`,
  `settlementKind`, `advanceSupply`, `paymentMethodId`, `reference`,
  `version` (draft token), `totalPaise`, `roundOffPaise`, `affectsTax`, and a
  print snapshot that reprints read alone. A Journal requires `narration` and leaves
  the party, method and settlement fields null.
- **Document Line**: `kind`, Account, description, `amountPaise`, and optional
  `itemId`, `hsnSac`, `unit`, integer `quantity`, integer `unitPricePaise` and
  `taxRateId`. `cgstPaise`, `sgstPaise` and `igstPaise` store the computed GST
  split. `amountPaise` remains the taxable value.
- **Exposure Side** (`receivable`, `payable` or null) is the control that a
  document settles, not the cash direction. A customer refund is a
  `receivable` Payment.
- **Party Ledger Line**: exposure per document, party and side, positive when
  the Party owes the Organization. An Invoice, a non-direct Receipt and an
  advance Payment write one; from slice 9 a Journal writes one per party and
  side it touches; from slice 7 each opening item writes one, dated the cutover.
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
2. **Money** follows [Development](../development.md#code-rules). Item unit
   prices are integer paise and quantities are integers of at least one.
   Fractional prices or FX require a new precision contract.
3. **One `orgProcedure` per mutation**, in one transaction. Reads are separate.
4. **Posting in code, accounts and rates in data**
   ([Architecture](../architecture.md#posting-mechanics-in-code-accounts-and-rates-in-data)).
   A line stores the tax rate row it used. Bank charges and write-offs are
   account lines.
5. **Supply type and tax.** The Organization `stateCode` and the Invoice's
   editable `placeOfSupplyStateCode` decide intra- or inter-state supply; the
   form defaults place of supply from the Party. A line gets its dated rate
   only when the Organization has a `gstin` and the line Account is `taxable`,
   so no `gstin` means no tax lines. Each GST component is a separately levied
   tax and is rounded separately: `computeTax` rounds a component's running
   total half-up and gives each line the increase, so the lines sum to that
   component's document total. CGST and SGST each take half the rate, so an
   odd rate is exact. The document tax total is therefore the sum of the
   rounded components, never the rounded sum, so a tiny line can carry zero
   tax where the unsplit rate would round to one paise: an intra-state
   10-paise line at 5% rounds each 2.5% half to zero, while one 5%
   calculation would round to a paise. That is intended. `roundOff` rounds
   gross to the rupee and posts the signed difference to the `roundOff`
   Account. A zero-total Invoice is refused (`INVOICE_ZERO_TOTAL`). **Invoice
   lines are Items only**: the Item carries the income Account and the dated
   rate, and the line may override its description and price. No Items are
   seeded. A one-off charge uses a generic Item (for example "Professional
   fees") that the owner or accountant creates once, as in ERPNext and Zoho
   Books; operators do not gain `item` `create` (call 10).
   Decided 2026-09-25 (#10): ERPNext's Sales Invoice Item requires an
   `item_code` and only the Item Manager role creates Items; Zoho Books'
   invoice API requires `item_id` on every line. `TAXABLE_ACCOUNT_LINE`
   remains for Journals.
6. **Print class**: an Invoice with any line carrying a Tax Rate prints Tax
   Invoice; otherwise it prints Bill of Supply, which covers exempt and nil
   lines and every line of an unregistered Organization. A Receipt prints
   Receipt. Printed fields are data that the CA approves.
7. **Locks.** From slice 5, posting on or before the general lock needs an
   exception. An exception clears the general lock only; the tax lock is
   reopened by `lock.set` with an earlier date or null and a reason. The tax
   lock follows `affectsTax`, stored at post, which marks any document in a GST
   register, exempt direct Receipts included. `allocation.apply` and
   `allocation.reverse` check the lock on their entry date.
   A cancellation is checked on its reversal date. **Every document reverses
   on its own `documentDate`** (D1), the Opening Balance on its cutover date,
   so cancellation and replacement correct historical balances. A locked cutover needs an authorized exception
   or reopening; keeping the period closed instead calls for a current-period
   Journal adjustment without cancelling the opening. Ledger rows remain
   append-only and `cancelledAt` records the actual cancellation instant
   ([approved policy and references](../research/opening-balance-correction-policy-2026-09-22.md)).
8. **External posting is post-MVP.** References, digests, deduplication,
   ingestion and API keys arrive together.
9. **Reports.** Accounting reports read journal lines. P&L and balance sheet
   come from Statement Definitions: account `type` and the chart's group tree
   (slice 6). Each report states its range, and prints "period not closed"
   until period close exists.
10. **Roles.** `owner`: everything. `accountant`: masters, every document,
    allocations, reports, exports. `ca`: reads everything, exports, sets locks
    and exceptions, never posts. `operator`: creates and posts Receipt, Payment
    and Invoice, reads masters, prints; never cancels, creates masters or
    exports, and never applies or reverses allocations after post. Allocations
    made at Receipt post come with `receipt:post`. Grants are per document type
    and action (`read`, `create`, `post`, `cancel`), plus `allocation` `apply`
    and `reverse`.
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
16. **Receipt settlement.** The user picks the kind; nothing is inferred.
    `against` carries allocations, `advance` does not, and `direct` stays
    explicit.

    | Kind      | Money for              | Debit          | Credit                    | Also                         |
    | --------- | ---------------------- | -------------- | ------------------------- | ---------------------------- |
    | `against` | Open Invoices          | Method account | `receivables`, party      | Allocations; rest is advance |
    | `advance` | A claim not yet raised | Method account | `customerAdvances`, party | A party ledger line          |
    | `direct`  | Income with no claim   | Method account | The income Account        | Nothing                      |

    A Receipt never computes tax. With a `gstin`, a `direct` Receipt to a
    `taxable` account is refused (`TAXABLE_DIRECT_RECEIPT`). `exempt`, `nil`
    and `nonGst` accounts feed the register's exempt table; `notASupply` stays
    out. An `advance` stores `advanceSupply`: `goods` (no GST, Notification
    66/2017), `exempt`, or `taxableService`, which is refused
    (`ADVANCE_TAX_UNSUPPORTED`) until GST advance documents exist. The database
    requires `advanceSupply` on an `advance` and forbids it on a `direct`
    Receipt. The receipt router stores it on an `against` Receipt only when an
    advance remainder exists, and refuses a remainder without it
    (`ADVANCE_SUPPLY_REQUIRED`). Allocations made at post fix the kind; a later
    `allocation.apply` never changes it. An `against` Receipt credits
    `receivables` for the allocated amount and `customerAdvances` for the
    remainder; its party ledger line is the negative full amount. Applying an
    advance to an Invoice posts Dr `customerAdvances` / Cr `receivables`.
    Supplier allocation, note allocation and Payment settlement follow the
    [4b-ii contract](#slices).

17. **Settlement changes.** Allocations are append-only `apply` and `reverse`
    rows; one reverse may name each apply. A document's allocation capacity
    for a Party is its signed net `receivables` movement for that Party: a
    debit is a target, a credit a source. Party statement balance and
    allocatable capacity are different quantities. A Receipt or Invoice moves
    one control account, so its party ledger line is its capacity. A Journal's
    party ledger line is a per-side net and would count a `customerAdvances`
    credit as `receivables` capacity; a Journal's capacity is therefore read
    from its `receivables` lines, never from net control exposure. Slice 9a
    admits only `receivables` to Journals, so the two agree until another
    control account is admitted with its own settlement rule.
    Sources hold a credit: `advance` and `against` Receipts, from slice 9a
    a Journal with a `receivables` credit, and from slice 7 an `openingCredit`.
    Targets hold a debit: Invoices, from slice 7 an `openingClaim`, and
    from slice 9b a Journal with a `receivables` debit. A `direct` Receipt
    credits income, holds no exposure and is neither
    (`ALLOCATION_SOURCE_INVALID`). Active means an apply without a reverse.
    Outstanding is capacity minus active allocations targeting the document;
    unapplied is capacity minus active allocations from it.
    `allocation.apply` and `allocation.reverse` lock the source and targets
    `FOR NO KEY UPDATE` in ascending document id order, then recheck. An
    allocation insert takes `KEY SHARE` on both documents it names, and a
    `FOR UPDATE` lock would make that wait out of id order. A cancellation
    first moves the document to `cancelled`; that row lock orders it against
    any apply or reverse on the same document, so the allocations it reads next
    are current. An allocation writes a journal entry only when it moves
    exposure between control accounts. Applying an advance to an Invoice
    writes Dr `customerAdvances` / Cr `receivables` with document type
    `allocation` and the allocation id; reversing it reverses that entry.
    Reversing an allocation made at Receipt post instead posts Dr
    `receivables` / Cr `customerAdvances`. From slice 9a, a source already on
    `receivables`, a Journal credit, allocates with no entry, and its reverse
    writes none: the credit was posted once, by the Journal, and a second entry
    would count it twice. A target with active allocations refuses cancellation
    (`CONFLICT`, naming the sources); the record Sheet offers Cancel only once
    every allocation is reversed. Receipt cancellation (and Journal
    cancellation from slice 9a) appends reverse rows for its active
    allocations, with no journal entry of its own, and reverses every
    un-reversed allocation journal entry from the document. `allocation.apply` and `allocation.reverse` check the period lock
    on their entry date. Slice 4b-ii uses this model: it keeps ERPNext's
    separate advance account, and rejects Zoho-style gross posting, which sends
    every Receipt through the advance account and doubles journal rows, and the
    Odoo and Tally shape without an advance account, which loses the liability
    that Schedule III and GST advance tracking need.
18. **Due dates.** Posted Invoices and Bills expose outstanding,
    `settlementStatus` (`paid`, `partPaid`, `unpaid`) and `overdue`. Their
    lists take one `status` filter: a document state, or `open` / `overdue`.

## Slices

Each open slice lists the deleted outpatient billing code that solved a similar
problem. Git keeps it at `a716b6c`. Read it; do not copy it.

1. **Spine, Party, templates, money.** Implemented: the settings row, chart
   templates, Parties with a namesake check and one GSTIN per Organization (an
   application check, `PARTY_GSTIN_TAKEN`), master lists complete to 5,000
   rows then `MASTER_LIST_LIMIT` (parties search the server instead), money
   accounts and methods.
2. **Receipt.** Implemented: `receipt.post` (`direct`, `advance`, and `against`;
   no draft), `get`, `list`, `partyTotals`, `cancel`, the day book XLSX, and
   the snapshot PDF at `/api/$orgSlug/receipts/$receiptId/pdf`. `against`
   allocations use `party.openItems`; credits use `party.openCredits` (4b-ii).
   Open: CA acceptance, and posting p95
   under 30 ms on native PostgreSQL at 100,000 lines (`db:seed:volume`, 100,000
   receipts per organization).
3. **Payment with TDS.** Implemented: `payment.*`, `tdsSections({ date })` and
   the TDS register XLSX. TDS is the amount times the rate, half-up to the
   rupee, at the earlier of credit or payment. A Party without a PAN is refused.
   The register reads the PAN from the snapshot, and a Form 140 correction fixes
   a filed quarter. The web form is available. Open: the CA verifies the 13-row seed.
4. **Invoice and settlement**, in three parts.

   **4a. Items, GST calculation and Invoice.** Implemented: dated Tax Rates;
   `item.{list,create,update,setActive,taxRates}`; pure `computeTax`; and
   `invoice.{saveDraft,post,get,list,cancel,discardDraft}`. An Invoice posts
   Dr receivables for the Party total, one Cr per income Account, and output
   CGST, SGST or IGST credits. Positive round-off is a credit; negative
   round-off is a debit. Its Party ledger line is the positive receivable.
   `affectsTax` is true when the Organization is registered and any line
   Account is not `notASupply`. The returned `printClass` is `taxInvoice` when
   any line has a Tax Rate, otherwise `billOfSupply`; it does not change the
   PDF title (see Invoice PDF below). `invoice.get` and `bill.get` return
   `totals` (taxable, CGST, SGST and IGST) summed on the server, which the
   detail, the draft editor and the PDF show. CA acceptance of the GST seed is
   open.

   `postDocument` takes a lines array and `draft: { id, version } | null`.
   Receipt and Payment pass one `accountLine`. `invoice.saveDraft` and
   `invoice.post` take an optional `draft: { id, version }`: without it they
   write a new Invoice, and with it they replace or post that draft.
   `invoice.discardDraft` requires the token and deletes the matching draft. A
   stale token is `CONFLICT`. A draft has no number or journal. Posting uses
   `invoicePrefix`. Invoice post and cancel are audited.

   Item permissions let owner and accountant create, read and update. Operator
   and CA read. The web lists Invoices at `/$orgSlug/invoices` with each record
   in a Sheet (detail, cancel, discard); a new Invoice and a draft are edited on
   the pages `/$orgSlug/invoices/new` and `/$orgSlug/invoices/$invoiceId/edit`
   (Design §10: a line grid is a Page). Items live under Masters.

   **4b-i. Allocations and Invoice settlement.** Implemented: append-only
   allocations; Receipt `against`; advance-to-Invoice apply and reversal
   entries; allocation-aware cancellation; Invoice outstanding, settlement
   status, and open or overdue filters. The original `invoice.openInvoices`
   and `receipt.unapplied` pickers returned the 200 oldest rows and `hasMore`;
   4b-ii replaces them with `party.openItems` and `party.openCredits`, both
   scoped by side. The web supports Receipt allocation at post, allocation
   detail and reversal, applying a credit, Invoice settlement status, and open
   or overdue filtering. CA acceptance is open.

   **4b-ii. Bills, notes and remaining settlement.** Implemented. Bill,
   Credit Note and Debit Note; Payment `against`; fee and write-off lines;
   customer TDS; counter sale; cancel-and-copy (`amendedFrom`); GST registers;
   Invoice PDF; header discount; and supplier, note and Payment allocation.
   The contract:

   - **Storage.** `documents` gains `discountPaise` (not null, default 0,
     `>= 0`), `amendedFromId` and `againstDocumentId` (nullable, composite
     keys to `documents`), and `intraState`, the supply type stored when an
     Invoice or Bill is written and copied to its notes, so a later settings
     or Party state change never reclassifies it. `document_lines` gains
     `discountPaise` (not null, default 0), `itcEligible` (nullable boolean,
     set on Bill and Debit Note lines only), `sourceLineId` (nullable
     composite key to `document_lines`, set on note lines only) and
     `adjustmentKind` (nullable: `fee`, `writeOff`, `tds`).
     `tds_deductions` gains `basePaise`: a Payment's gross, a Bill's taxable
     total. A Bill draft keeps its section in that row. `organization_settings`
     gains `billPrefix` (`BILL`) and `debitNotePrefix` (`DN`);
     `creditNotePrefix` (`CN`) exists. The baseline is regenerated (rule 4);
     no environment retains data.
   - **Sides and roles.** A settling document writes one party ledger line.
     Its allocation capacity is the absolute amount of that line's `post`
     row, read from `party_ledger_lines`, never `totalPaise`. A unique index
     on `(orgId, documentId, partyId, kind)` makes the one row a database
     fact, so every register, detail and picker reads outstanding and
     unapplied per row through one correlated, index-backed expression
     (`settlementPaise`), never a grouped aggregate of the organization. On each side a
     _target_ holds the claim and a _source_ settles it:

     | Side         | Targets (claim)                        | Sources (settle)                                    | Ledger sign        |
     | ------------ | -------------------------------------- | --------------------------------------------------- | ------------------ |
     | `receivable` | Invoice; refund Payment (`receivable`) | Receipt `advance`/`against`; Credit Note            | target +, source − |
     | `payable`    | Bill                                   | Payment `advance`/`against` (`payable`); Debit Note | target −, source + |

     An allocation pairs one source and one target of the same Party and
     side. Outstanding is target capacity less active allocations to it;
     unapplied is source capacity less active allocations from it. Locking,
     append-only rows and cancellation follow call 17 unchanged.

   - **Allocation entries.** Only a Receipt or Payment source holds its
     unapplied amount on the advance account. Applying one after post writes
     `receivable` Dr `customerAdvances` / Cr `receivables`, or `payable` Dr
     `payables` / Cr `supplierAdvances`; reversing reverses that entry, and
     reversing an allocation made at post writes the opposite (release)
     entry. A note source sits on the control account already: its applies
     and reverses write no entry. `AllocationPosting` is
     `{ type: "allocation", side, direction: "apply" | "release", partyId, amountPaise }`.
   - **Bill** (`bill:*`; owner and accountant post and cancel, CA reads).
     Drafts as the Invoice (`saveDraft`, `post`, `discardDraft`, version
     token). Header: supplier `partyId` with a `stateCode`, `documentDate`
     (the supplier's invoice date), required `reference` (the supplier's
     invoice number, 1–40), optional `dueDate`, `placeOfSupplyStateCode`
     (defaults to the Organization state), optional `tdsSectionId`,
     `narration`. 1–100 account lines
     `{ accountId, description, amount, taxCode?, hsnSac?, itcEligible }`: an active non-system expense or asset
     leaf. `taxCode` resolves to the rate effective on the Bill date; an invalid
     code is `TAX_CODE_INVALID`. The form ticks `itcEligible` on a new line, as
     Zoho Books and India Compliance treat input tax as eligible unless marked
     (revisit with the CA). `amount` is the taxable value.
     Tax is `computeTax` with intra-state when the Party `stateCode` equals
     the place of supply. `itcEligible` is forced false when the Organization
     has no `gstin`. TDS is `computeTds` on the taxable total at the Bill (the
     earlier of credit or payment), needs the Party PAN
     (`TDS_PAN_REQUIRED`), and writes one `tds_deductions` row. Posting: Dr
     each line account for its taxable value plus its tax when not
     `itcEligible`; Dr `cgstInput`, `sgstInput`, `igstInput` for eligible tax;
     Cr `tdsPayable` for TDS; round-off as the Invoice; Cr `payables` for the
     rest, which is the capacity. `affectsTax` is true when the Organization
     is registered. Settlement status and overdue as call 18.
   - **Credit Note and Debit Note** (`note:*`, one resource; no draft). A
     note names `againstDocumentId`: a posted Invoice (Credit Note) or a
     posted Bill (Debit Note) with `documentDate` on or after the source's.
     Lines are `{ sourceLineId, amount }`, 1–100, each a distinct line of the
     source; `amount` is the taxable value credited, and the note's tax uses
     the source line's rate and the source's supply type. The cumulative
     taxable per source line across posted notes may not exceed the line's
     (`NOTE_EXCEEDS_SOURCE`); a line credited in full takes exactly the
     line's remaining tax components, otherwise `computeTax` and the same
     bound per component. The note total rounds as the Invoice, and the
     cumulative note total is bounded by the source total. A Credit Note
     posts Dr income per account, Dr output GST, Cr `receivables`; a Debit
     Note posts Dr `payables`, Cr each account (including ineligible tax), Cr
     input GST for eligible tax. Both copy `affectsTax` from the source. At
     post a note allocates to its source up to the source's outstanding; the
     rest stays an unapplied source. Numbering uses `creditNotePrefix` and
     `debitNotePrefix`.
   - **Payment `against`.** `exposureSide` is explicit input. `payable`:
     `allocations` of `{ documentId, amount }` target posted Bills of the
     Party (1–50); the remainder is a supplier advance (Dr `supplierAdvances`).
     It takes no TDS: the Bill deducts at credit.
     `receivable` is a refund: the targets are the Payment itself and the
     allocations name Credit Notes as sources; the amount equals their sum
     exactly and no TDS is allowed. Unused Receipt advances stay unrefundable
     (Deferred).
   - **Fee, write-off and customer TDS.** A Receipt `against` may carry
     `adjustments` of `{ kind: "fee" | "writeOff" | "tds", accountId?, amount }`,
     at most 5: `fee` and `writeOff` name an active non-system expense leaf,
     and `tds` posts to `tdsReceivable` with no account input. Each is a debit
     that settles with the money: capacity is the amount received plus the
     adjustments. A Payment `against` `payable` may carry `writeOff` (credit
     to an active non-system income or expense leaf, settles) and `fee` (Dr
     an expense leaf, Cr the method; does not settle). A document with
     settling adjustments allocates its whole capacity, so no advance
     remainder mixes with a write-off (`ADJUSTMENT_UNALLOCATED`). Adjustments
     are stored as account lines with `adjustmentKind`.
   - **Header discount** (Invoice). Optional `discount` or `discountPercent`
     (up to two decimals, above 0 and at most 100, half-up to the paisa on the
     subtotal) splits pro rata over each line's pre-discount value, half-up.
     Supplying both is `BAD_REQUEST` (`DISCOUNT_CONFLICT`). Rounding starts on the
     largest line, then follows input order if needed, so every line's
     discount stays between zero and its pre-discount value. A line stores its `discountPaise`, and
     `amountPaise` stays the taxable value after discount. A discount above
     the subtotal is `DISCOUNT_EXCEEDS_SUBTOTAL`; a zero total stays
     `INVOICE_ZERO_TOTAL`.
   - **Counter sale.** `invoice.post` takes optional
     `settle: { payments: [{ paymentMethodId, amount, reference? }] }` (1–4
     lines) and, in the same transaction, posts one `against` Receipt per line
     allocated to the Invoice for its amount. The sum may fall short of the
     total, which stays outstanding, but never exceed it
     (`SETTLEMENT_EXCEEDS_TOTAL`). The Invoice numbers before its Receipts, in
     line order. Needs `invoice:post` and `receipt:post`
     ([invoice editor](./invoice-editor.md)).
   - **Cancel and copy.** `invoice.amend` takes `{ invoiceId, reason }` and
     `bill.amend` takes `{ billId, reason }`. Each cancels under the normal
     rules and returns a new draft copying the header and lines with
     `amendedFromId`. Need `cancel` and
     `create` on the type. Audited.
     An Invoice or Bill with any posted note against it refuses both cancel
     and amend (`CONFLICT`, naming the notes).
   - **Pickers.** `party.openItems({ partyId, side })` returns targets with
     outstanding (`{ id, type, number, documentDate, dueDate, outstandingPaise }`)
     and `party.openCredits({ partyId, side, type?, q? })` returns sources with unapplied
     credit (`{ id, type, number, documentDate, unappliedPaise }`). Both return a
     page (`limit`, default 25) oldest first by date then id, with `hasMore`; the
     next page passes the last row's id as `cursor`, so no row is out of reach.
     The optional credit `type` and the search `q` (number, reference or
     narration) filter before the page;
     reading credits requires the Note read grant. They replace `invoice.openInvoices` and
     `receipt.unapplied`. `allocation.apply` takes
     `{ sourceDocumentId, targetDocumentId, amount }`.
     Invoice and Payment details omit related Note or Bill metadata for a role
     without that document's read grant.
   - **GST registers** (`export.gstOutwardXlsx`, `export.gstInwardXlsx`,
     `{ from, to }`, `export` grant). Posted, uncancelled documents with
     `affectsTax` in the range. Outward: Invoices and Credit Notes (negated)
     grouped by document and rate into B2B (Party `gstin`), B2CL (inter-state,
     unregistered, Invoice total above ₹1,00,000) and B2CS (the rest, by place
     of supply and rate); CDNR and CDNUR for notes; HSN summary by `hsnSac`
     and rate; an exempt sheet of `nil`, `exempt` and `nonGst` lines and
     direct Receipts. The exempt sheet splits inter- and intra-state by place
     of supply against the Organization's state, as ERPNext's GSTR-1 does. A
     direct Receipt stores its place of supply and `intraState` when posted:
     the Party's state when it names one, else the Organization's (an
     over-the-counter supply to an unregistered recipient). A register row
     without a supply type is an invariant failure, never a default. Inward: Bills and Debit Notes (negated) by document and
     rate, with eligible and ineligible tax. The registers read documents and
     lines, never `advanceSupply`. The TDS register includes Bills.
   - **Invoice PDF** at `/api/$orgSlug/invoices/$invoiceId/pdf`, as the
     Receipt PDF: `invoice.get`, the print snapshot and the stored lines. The
     title is "Invoice" until the CA approves print classes (Product). It
     prints the Party as "Bill to" and, when the Invoice names an address of
     delivery, "Ship to" with its state name and code (rule 46(o); the address
     lives only in the print snapshot, see `invoice-ship-to.md`). A Tax
     Invoice states "Reverse charge No" (rule 46(p)). It ends
     with "For" the legal name over an Authorised signatory line (CGST rule
     46(q)). Line HSN/SAC meets rule 46, so there is no HSN summary table; the
     GSTR-1 register carries that summary. One PDF link opens it inline; the
     browser viewer prints and saves.
   - **Web.** Bills and Payments under Purchases; Credit and Debit Notes
     under a Notes list; Bill pages as the Invoice (line grid); the Payment
     form a Sheet; a note is a page picked from its source record. The
     Invoice form adds Discount and Counter sale; the Receipt form adds
     adjustments; record Sheets add Amend, Apply credit (both sides) and the
     Invoice PDF.

   **Released credits versus advances.** Reversing an allocation on a fully
   allocated `against` Receipt posts `invoiceToAdvance`, yet the Receipt stored
   no `advanceSupply` and `reverseAllocation` records none, so the released
   credit is unclassified while the journal balances. The same applies to a
   Payment `against` remainder released to `supplierAdvances`. A credit
   released from a previously billed settlement is not an advance accepted
   before supply, and a document's nullable `advanceSupply` is never
   authoritative for a later state. Settle the model — classify released
   credits explicitly, or record them as released credits distinct from
   advances — before any tax workflow reads `advanceSupply`. Never rewrite
   the posted document to manufacture that history.
   - Legacy reference (a716b6c):
     - Header discount: split pro rata, half-up, with the residue on the
       largest line, so lines sum to the header
       (`a716b6c:packages/api/src/lib/invoice-math.ts:35-106`).
     - Credit Note bounds: work back from gross, bound each line per component
       against earlier credits, and bound the total by the Invoice. A refund
       needs bounds for the note total and negative outstanding
       (`a716b6c:packages/api/src/routers/billing.ts:632-953`).
     - Counter sale numbering: number Invoice and Receipt last, in fixed type
       order, so two series locks never deadlock
       (`a716b6c:packages/db/src/counter.ts:8-26`).
     - GST registers group stored lines by document, rate and HSN, negate
       notes, and include IGST, place of supply and B2B/B2CS
       (`a716b6c:packages/api/src/lib/report-math.ts:190-383`).
     - Avoid correlated per-row subqueries, reads that write,
       `regexp_replace` in `WHERE`, and `Promise.all` inside a transaction.

5. **Journal, Opening Balance, locks.** Implemented: `journal.*`,
   `openingBalance.{post,get,cancel}`,
   `lock.{get,set,grantException,revokeException}`, the `/$orgSlug/journals`
   routes and Settings > Opening balance and Settings > Locks. Open: CA
   acceptance.
   - Legacy reference (a716b6c):
     - Attachments, when the CA asks: lock the parent `FOR UPDATE` and the file
       row `FOR KEY SHARE`, so `file.delete` waits; a duplicate insert returns
       `CONFLICT` (`a716b6c:packages/api/src/routers/opd.ts:933-1003`).
6. **Reports.** Implemented, 6a–6d. 6a is the proof slice for the shared
   report path and the latency budget, so it goes first. Trial balance,
   account ledger, day book, P&L and balance sheet are Accounting reports
   (call 15) over journal lines joined to their journal entries; the party
   statement is the Billing report `party.statement` already serves. Each report
   has one query and builder in the API; its JSON procedure, XLSX export and
   PDF all read that builder's result shape, so the three formats show the
   same figures. ERPNext, Zoho Books and TallyPrime
   were checked for the shapes below
   ([reference](../research/reports-and-import-references-2026-09-27.md)).
   The shared contract:

   - **Dates.** Inclusive `from` and `to` (`orderedPeriod`), or one `asOf`,
     in the Organization's calendar. Activity is dated by
     `journal_entries.entryDate`. A cancelled document's post and reverse
     entries each count on their own date; no Accounting report filters on
     `documents.state`, so a closed month never changes when a later
     cancellation posts. A period's opening is the sum of every line dated
     before `from`, the Opening Balance entry included; there is no opening
     flag.
   - **Amounts.** bigint paise through the procedure, as `party.statement`
     returns them; rupee numbers only in XLSX cells (Development);
     `formatMoney` on screen and in PDF. A debit and credit pair is two
     non-negative columns; a balance is one signed figure shown Dr or Cr.
   - **Accounts.** Every account with a non-zero opening or a line in range
     appears, archived ones included and marked Inactive; a row whose
     opening, debits and credits are all zero is dropped. Rows sort by
     account code.
   - **Size.** Summary reports (trial balance, P&L, balance sheet) have one
     row per account and no bound. Interactive account ledger, day book, and
     party ledger lists use keyset pages plus separate totals; a CA can scroll
     a whole period. Full detail reports for JSON/PDF and XLSX use server-chosen
     limits of 5,000 and 100,000 lines respectively. XLSX calls the builder,
     not the capped JSON procedure. The full-report query fetches limit + 1
     lines and, above the limit, returns `BAD_REQUEST` `REPORT_TOO_LARGE` with
     "choose a shorter period"; nothing is truncated.
   - **Permissions.** Accounting reports need `report:readFinancial` (owner,
     accountant, ca). XLSX adds `export:read`. A PDF route calls the JSON
     procedure, so it needs the same grant. The party statement keeps
     `{ party: read, report: read }`; its XLSX adds `export:read`.
   - **Header.** Each result carries a `ReportHeader`: `organization:
{ legalName, gstin: string | null }` and `timeZone` from
     `organization_settings`, the range as requested, and `generatedAt` (an
     instant). XLSX rows 1–4 hold the legal name, the report title, the range
     and "Generated <date and time in the Organization zone> · period not
     closed" (call 9), then the header row. The PDF prints the same header on
     every page, a repeating table header and page numbers; `pdf-render.tsx`
     today repeats only the footer, so 6a extends it without changing the
     Receipt and Invoice PDFs.
   - **Statement definition** (call 9). The P&L and balance sheet take their
     sections from account `type` and their grouping from the chart's
     `parentId` tree; there is no mapping table. Their titles are "Profit and
     loss" and "Balance sheet"; neither claims Schedule III (Deferred).
   - **Where.** `report.{trialBalance,profitAndLoss,balanceSheet,accountLedger,dayBook}`
     in `packages/api/src/routers/report.ts`; SQL in
     `packages/api/src/lib/reports.ts`; pure builders in
     `packages/api/src/core/reports.ts`. XLSX in `export.*Xlsx`. PDF at
     `/api/$orgSlug/reports/<report>/pdf?…` through `pdfResponse`, as the
     Invoice PDF. Web pages at `/$orgSlug/reports/<report>` (flat route files
     `reports_.<report>.tsx`) with a period control from `date-presets`, the
     table, and Download XLSX and PDF. Report tables may scroll sideways
     (Design §8). `/$orgSlug/reports` becomes the index: each report the
     member may read, then the existing GST and TDS registers, each gated by
     its own grant.

   **6a. Trial balance and latency proof.** Implemented.
   - `report.trialBalance({ from, to })` returns
     `{ header, rows, totals }` (`header.range` holds `from` and `to`); a row is
     `{ accountId, code, name, type, parentName, active, openingDebitPaise, openingCreditPaise, debitPaise, creditPaise, closingDebitPaise, closingCreditPaise }`
     and `totals` holds the six sums. Rows are posting leaves; `parentName`
     names the group, as the chart shows it. Opening `O` is
     `sum(debit - credit)` before `from`, shown Dr when positive; closing is
     `O + debit - credit`, shown the same way. One report reads one database
     snapshot: one grouped read of journal lines through `to` supplies both
     opening and period amounts in one read-only Repeatable Read transaction,
     as `invoice.get` does (legacy below). Opening, period and closing totals each balance;
     an unbalanced total is an invariant failure (`impossible`, a 500), never a
     difference row.
   - `export.trialBalanceXlsx({ from, to })` adds a totals row. PDF at
     `/api/$orgSlug/reports/trial-balance/pdf?from=&to=`. Page
     `/$orgSlug/reports/trial-balance`, default this financial year; desktop
     columns Code, Account, Opening, Debit, Credit, Closing; mobile cards show
     Account, Opening and Closing.
   - **Latency.** `scripts/benchmark-rpc.ts` has a `trial_balance` scenario:
     the last 365 days for Meridian Traders after `bun run db:seed:volume`
     (about 200,000 journal lines, twice the target volume). Target p95 under
     100 ms on native PostgreSQL. Record the numbers and
     `EXPLAIN (ANALYZE, BUFFERS)` in the work registry. Journal lines carry
     the entry date under a composite foreign key, so report totals read
     `journal_lines` directly. A period-close roll-up stays Deferred unless
     the measured scan exceeds the budget at required volume.
   - Acceptance, on one proprietorship Organization. April is the first month
     of the financial year before the one containing the run date, and 31
     March is the day before it. Opening Balance on
     31 March (`Cash in Hand` 50,000 Dr, `Capital Account` 50,000 Cr); an
     exempt Invoice to Priya for 10,000 on 10 April; a Receipt `against` it
     for 4,000 on 12 April, into `Cash in Hand`; a Journal Dr `Sibling
Discount` (an expense leaf from `account.create`) / Cr `Cash in Hand` 500
     on 28 April, cancelled during the test, so `reverseDocument` dates its
     reversal the run date. The April trial balance shows `Cash in Hand`
     opening 50,000 Dr and closing 53,500 Dr, and the Journal's lines; the
     trial balance for today shows only its reversal; every account's
     closing equals `sum(debit) - sum(credit)` through `to`, computed directly
     in the test; the XLSX totals row equals the JSON totals; the PDF answers
     `application/pdf`; an operator is `FORBIDDEN`. The benchmark p95 is
     recorded under 100 ms.
   - Verify: new `tests/integration/report.test.ts` (the acceptance as one
     happy path, the operator refusal as the failure path); new
     `tests/unit/reports.test.ts` for `buildTrialBalance` (Dr/Cr netting,
     zero-row drop); the `GUARDED_CALLS` table; `bun run check-types`;
     `bun run benchmark:rpc` at volume; the page at 1440 and 390 px in both
     themes.
   - Depends on: none. Owns: `packages/api/src/routers/report.ts`,
     `packages/api/src/lib/reports.ts`, `packages/api/src/core/reports.ts`,
     `apps/web/src/lib/report-pdf.tsx`,
     `apps/web/src/routes/api.$orgSlug.reports.trial-balance.pdf.ts`,
     `apps/web/src/routes/$orgSlug/reports_.trial-balance.tsx`,
     `tests/integration/report.test.ts`, `tests/unit/reports.test.ts`.
     Touches (coordinator-owned): `packages/api/src/routers/index.ts`,
     `packages/api/src/routers/export.ts`,
     `apps/web/src/routes/$orgSlug/reports.tsx`, `apps/web/src/lib/pdf-render.tsx`,
     `tests/integration/tenancy.test.ts`, `scripts/benchmark-rpc.ts`, and,
     only if the index fallback runs, `packages/db/src/schema/journal-lines.ts`
     and `packages/api/src/core/posting.ts`.
   - Interfaces: `accountActivity(orgId, { before } | { from, to })` returns
     `{ accountId, debitPaise, creditPaise }[]`; `accountActivitySince(orgId,
{ through, since })` also returns `sinceDebitPaise` and `sinceCreditPaise`.
     `reportHeader(orgId, range)` returns `ReportHeader = { organization: { legalName: string; gstin: string | null }; timeZone: string; range: { from: string; to: string } | { asOf: string }; generatedAt: Date }`.
     `reportProfile(orgId)` returns the settings row with `financialYearStart`;
     `headerFromProfile(profile, range)` builds the header from it.
     `reportTooLarge(limit)` in `lib/reports.ts` builds the
     `REPORT_TOO_LARGE` error for 6c and 6d. `ReportPdf` in `report-pdf.tsx`
     takes `{ header, title, columns, rows, totals }`;
     `reportXlsx(header, title, columns, rows, totals?)` in `export.ts`
     writes the four header rows.

   **6b. P&L and balance sheet.** Implemented.
   - `report.profitAndLoss({ from, to })`: Income (credit less debit) and
     Expenses (debit less credit) for the period, each a tree of groups with
     subtotals and leaves; zero leaves and empty groups are dropped.
     `netProfitPaise` is income less expenses; a negative figure is a loss.
   - `report.balanceSheet({ asOf })`: Assets (debit less credit), Liabilities
     and Equity (credit less debit), cumulative through `asOf`, as trees.
     Equity adds two computed rows because no year-end close posts
     (Deferred): "Profit and loss, current year" (income less expenses from
     the start of the financial year containing `asOf` through `asOf`) and
     "Profit and loss, earlier years" (everything before it). Opening Balance
     lines on income or expense leaves count in the row of the financial year
     containing the cutover. A negative balance stays in its section as a
     negative figure (an overdrawn bank is a negative asset); nothing is
     reclassified. Assets must equal liabilities plus equity plus both rows,
     or the call is an invariant failure.
   - XLSX `export.profitAndLossXlsx` and `export.balanceSheetXlsx` indent
     groups; PDF and pages as 6a at `profit-and-loss` (default this financial
     year) and `balance-sheet` (default today). Groups collapse inline, and
     each leaf links to its account ledger (founder decision):
     from the P&L for the same period; from the balance sheet from the start
     of the financial year containing `asOf` through `asOf`, so the ledger's
     closing equals the row.
   - Acceptance, on the 6a fixture plus a `direct` Payment of 3,000 to an
     expense on 20 April: April P&L shows income 10,000, expenses 3,500 (the
     payment and the Journal) and net profit 6,500; the balance sheet at 30
     April balances with a current-year row of 6,500; a posting dated in the
     previous financial year lands in the earlier-years row; the P&L for a
     whole financial year equals the balance sheet's current-year row on its
     last day. `profit_and_loss` and `balance_sheet` benchmark scenarios over
     365 days record p95 under 100 ms at volume.
   - Verify: `tests/integration/report.test.ts` extended (the acceptance as
     one path); `tests/unit/reports.test.ts` for the tree subtotals and the
     balance check; `GUARDED_CALLS`; `bun run check-types`; the benchmark;
     both pages at 1440 and 390 px in both themes.
   - Depends on: 6a. Owns:
     `apps/web/src/routes/$orgSlug/reports_.profit-and-loss.tsx`,
     `apps/web/src/routes/$orgSlug/reports_.balance-sheet.tsx`,
     `apps/web/src/routes/api.$orgSlug.reports.profit-and-loss.pdf.ts`,
     `apps/web/src/routes/api.$orgSlug.reports.balance-sheet.pdf.ts`.
     Touches: the 6a-owned report modules and tests and the
     coordinator-owned files.
   - Interfaces: a statement node is
     `{ accountId, code, name, amountPaise, children }`; groups carry their
     subtotal in `amountPaise`.

   **6c. Account ledger and day book.** Implemented.
   - `report.accountLedger({ accountId, from, to })` takes any account of the
     Organization, archived and system accounts included; a group is
     `BAD_REQUEST` `ACCOUNT_INVALID`, and a foreign id is `NOT_FOUND`. It
     returns `openingPaise`, `lines` of
     `{ id, entryId, entryDate, kind, documentId, documentType, number, narration, partyName, debitPaise, creditPaise, balancePaise }`
     ordered by entry date and line id, and `closingPaise`;
     balances are signed, debit positive. A `reverse` row reads "Reversal of
     <number>". An allocation entry (document type `allocation`) shows
     "Allocation" and no link.
   - `report.accountLedgerLines({ accountId, from, to, cursor?, limit })`
     pages ledger lines by entry date and line id; `report.accountLedgerSummary`
     returns opening, debit, credit and closing amounts with the account.
   - `report.dayBook({ from, to, documentType? })` returns entries
     `{ entryId, entryDate, kind, documentId, documentType, number, narration, lines: [{ accountCode, accountName, partyName, debitPaise, creditPaise }] }`
     ordered by entry date, then entry id and line id, with debit and credit
     totals; the size bound counts lines. `number` is `string | null`: an
     allocation entry shows number null, narration "Allocation" and no link,
     as in the ledger, and `documentType` may filter on `allocation`.
   - `report.dayBookEntries({ from, to, documentType?, cursor?, limit })`
     pages complete entries by entry date and id; `report.dayBookSummary`
     returns entry count and debit/credit totals in one statement.
     `export.dayBookXlsx` changes from
     `{ date }` to `{ from, to, documentType? }` and reads this result; the
     Reports index's one-day card becomes the Day book page. Clean cutover:
     no single-date form stays.
   - Web: `/$orgSlug/reports/account-ledger?accountId=&from=&to=`, with an
     account combobox over `account.list` (archived included); a trial
     balance row links to it for the same period. `/$orgSlug/reports/day-book`,
     default today. Document numbers link to their records, as the party
     Ledger does.
   - Acceptance, on the 6a fixture: the `Cash in Hand` ledger for April opens
     at 50,000 Dr, shows the Receipt (4,000 Dr) and the Journal (500 Cr) and
     closes at 53,500 Dr; for today it shows the reversal. The day book for
     today lists the reversal with totals equal to the Journal's. The
     ledger builder called with `limit: 1` for 28 April through today is
     `REPORT_TOO_LARGE`, and with `limit: 100` returns the Journal line and
     its reversal.
   - Verify: `tests/integration/report.test.ts` extended; the day book test
     in `tests/integration/receipt.test.ts` moves to the range input;
     `GUARDED_CALLS`; `bun run check-types`; both pages in the app at 1440 and
     390 px in both themes.
   - Depends on: 6a. Owns: `apps/web/src/routes/$orgSlug/reports_.account-ledger.tsx`,
     `apps/web/src/routes/$orgSlug/reports_.day-book.tsx`, and their two PDF
     routes. Touches: the 6a-owned report modules and tests,
     `tests/integration/receipt.test.ts`, and the coordinator-owned files.
   - Interfaces: the ledger and day book builders take a numeric `limit`, so
     the procedure and XLSX pass 5,000 and 100,000.

   **6d. Party statement exports.** Implemented. The Ledger tab's All time
   header reads "As of" today.
   - `party.statement` gains the `ReportHeader` and
     `party: { name, gstin, address, stateCode }` and throws
     `REPORT_TOO_LARGE` above 5,000 lines. Its `from` and `to` stay optional:
     the Ledger tab's All time omits both, and the exports accept the same.
     `export.partyStatementXlsx({ partyId, from?, to? })` (100,000 lines) and
     a PDF at `/api/$orgSlug/parties/$partyId/statement/pdf?from=&to=`
     (either parameter may be absent): header, the Party block, opening, rows
     with running balance, closing. The party Ledger tab gains Download XLSX
     and PDF for its selected period.
   - Acceptance: Priya's April statement from the 6a fixture shows the
     Invoice, the Receipt and a closing balance of 6,000 in JSON, XLSX and
     PDF; a foreign `partyId` is `NOT_FOUND`.
   - Verify: `tests/integration/report.test.ts` extended; `GUARDED_CALLS`;
     `bun run check-types`; the Ledger tab at 1440 and 390 px in both themes.
   - Depends on: 6a (header, PDF layout and `reportTooLarge`).
     Owns: `apps/web/src/routes/api.$orgSlug.parties.$partyId.statement.pdf.ts`.
     Touches: `packages/api/src/routers/party.ts`,
     `apps/web/src/routes/$orgSlug/parties_.$partyId.ledger.tsx`, and the
     coordinator-owned files.

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
       with the period (`a716b6c:packages/api/src/routers/report.ts:41-73`);
       this spec bounds detail reports by lines instead.
     - Party statement: check the Party is in scope in parallel with the lines,
       so a foreign id is `NOT_FOUND`, not an empty statement
       (`a716b6c:packages/api/src/routers/customer.ts:54-66`).
     - Browser print, only if it stays beside the server PDF: print CSS that
       isolates `[data-report-print]` and forces light tokens
       (`a716b6c:apps/web/src/lib/report-presentation.ts:20-54`).
     - Charts: the rules were Design §11 (`a716b6c:docs/design.md:378-391`); a
       trend gap-fills in SQL with `generate_series`
       (`a716b6c:packages/api/src/routers/dashboard.ts:96-110`).

7. **Import.** Open, in four parts. One XLSX workbook creates masters and,
   optionally, the Opening Balance with the party opening items that make up
   its control balances, all or nothing. It is the only path for Party opening
   balances: there is no per-Party opening field or form, before or with this
   slice, and until 7a ships a cutover leaves Party balances out. A masters-only
   workbook imports at any time; a workbook with a trial balance or opening
   items imports while no Opening Balance is posted. ERPNext's Opening
   Invoice Creation Tool keeps bill-wise due dates but posts each opening
   invoice to a temporary account, and ERPNext, Zoho Books and TallyPrime all
   import partially; this contract keeps the due dates, derives the control
   legs from the items and writes nothing on any error
   ([reference](../research/reports-and-import-references-2026-09-27.md)).

   - **Opening items.** Two document types. An `openingClaim` is a legacy
     invoice or bill still unpaid, a target; an `openingCredit` is money
     received or paid on account and not yet matched, a source. Each has
     `partyId`, `exposureSide`, `documentDate` (the legacy date, on or before
     the cutover), `dueDate` (claims only, optional), `reference` (the legacy
     number, required, 1–40) and `totalPaise` above zero. A number series is
     keyed by document type, so claims number from the fixed `OC` prefix and
     credits from the fixed `OA` prefix, in the cutover's financial year
     (`OC25-26/4`, `OA25-26/1`). It has no lines or print snapshot, `affectsTax` false and no
     journal entry. It writes one party ledger `post` line dated the cutover
     (the Opening Balance `documentDate`), signed as the 4b-ii table:
     receivable claim +, receivable credit −, payable claim −, payable credit
     +. Dating every exposure at the cutover keeps the party statements
     summing to the control accounts on every date. The database requires
     `partyId` and `exposureSide` on both types.
   - **Control legs.** The trial balance's `receivables` and `payables` rows
     are checks, not postings: the Opening Balance posted by an import takes
     every other trial balance row as a line, then adds `receivables` once at
     the receivable net (claims less credits; Dr when positive, else Cr) and
     `payables` once at the payable net (claims less credits; Cr when
     positive, else Dr), omitting a zero net. These legs carry no party and
     write no party ledger lines; they pass through an import-only path that
     admits the two controls without `PARTY_REQUIRED`, derived from the
     items, never typed. `openingBalance.post` and Journals keep their rules.
     `customerAdvances` and `supplierAdvances` stay refused: an opening credit
     sits on the control account, as a 9a Journal credit does, and is not an
     advance (no `advanceSupply`).
   - **Settlement.** `roleOf(document, position)` returns a document's side
     for the position it may take, else null: an `openingClaim` only as a
     target and an `openingCredit` only as a source; capacity is the absolute `post`
     line (`settlementPaise`'s non-Journal branch). Applying or reversing from
     an opening credit writes no entry: it is already on the control account.
     Receipt `against` may target receivable claims, Payment `against`
     payable claims, and Apply credit may pair an opening credit with an
     Invoice, a Bill or a claim of its side. Receipt `allocations` already
     take `documentId` (slice 9b); payable Payment `allocations.billId`
     renames to `documentId`, with every API, web and test caller; the
     refund's `creditNoteId` stays. Clean cutover. Journal line
     `allocations.invoiceId` keeps its name: a Journal credit allocates only
     to Invoices (`applyAllocations`), never to an opening claim.
     `party.openItems` and `party.openCredits` list the items with the others,
     oldest first by their legacy `documentDate`, while the party statement
     places them on the cutover date of their ledger line; their rows gain
     `reference` (nullable). A note cannot
     name an opening claim (it has no lines). Refunding an opening credit by
     Payment is Deferred with unused advances.
   - **Cancel.** Items cancel only with their Opening Balance.
     `openingBalance.cancel` also reverses every posted item's party ledger
     line on the cutover date (the original-cutover rule, call 7) and marks
     each `cancelled`, in one transaction; it refuses with `CONFLICT`, naming
     the documents, while any item has an active allocation. There is no
     per-item cancel.
   - **Where they show.** The party statement ("Opening invoice", "Opening
     bill", "Opening credit" by side and type, unlinked), the party
     Transactions tab for a reader of `openingBalance`, the Receipt and
     Payment open-item grids, Apply credit, and Settings > Opening balance,
     where `openingBalance.items({ cursor?, limit })` pages the items oldest
     legacy date first (keyset on date and id, 25 by default, with `hasMore`) as
     `{ id, type, number, partyName, exposureSide, reference, documentDate, dueDate, totalPaise, balancePaise }`.
     `openingBalance.get` stays the header and lines. With 5,000 items beside
     105,000 documents, one page reads at p95 24 ms and 7 KiB; the unpaged
     list was p95 403 ms and 1.5 MB (2026-10-02, local, test database).
     Invoice and Bill lists, their open and overdue filters, and the GST and
     TDS registers are unchanged.
   - **Workbook.** One `.xlsx` of at most 5 MiB: `readImportWorkbook` checks
     `file.size` before parsing, and a larger file is `BAD_REQUEST`
     `FILE_TOO_LARGE`. Sheets in this order, each
     with its header on row 1 and data from row 2; every sheet but `Read me`
     may be empty:

     | Sheet           | Columns (\* required)                                                                                  | Rules                                                                                                           |
     | --------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
     | `Read me`       | Instructions; `B1` holds the template version `1`                                                      | Another version is `TEMPLATE_VERSION`                                                                           |
     | `Opening`       | Opening date\*                                                                                         | One row; required when either of the last two sheets has rows; not in the future                                |
     | `Accounts`      | Name\*, Parent\*, GST supply class                                                                     | Parent is a group's code or name or a type (Assets, …); `account.create` rules                                  |
     | `Parties`       | Name\*, Roles\*, GSTIN, PAN, State code, Address, City, PIN code, Email, Phone                         | Roles comma-separated; `party.create` rules, GSTIN derivation included                                          |
     | `Items`         | Name\*, Income account\*, Unit price\*, HSN/SAC, Unit, Tax code                                        | `item.create` rules; Unit price may be zero                                                                     |
     | `Trial balance` | Account\*, Debit, Credit                                                                               | Exactly one amount above zero; Opening Balance account rules, except the two control rows                       |
     | `Opening items` | Party\*, Side\* (Receivable, Payable), Type\* (Claim, Credit), Reference\*, Date\*, Due date, Amount\* | Unique by Party, Side, Type and Reference (trimmed, case-insensitive); Due date on claims only, not before Date |

     A cell is text, a number or a date. `readImportWorkbook` reads each
     cell's `type` and value from `sheet.cells` in sparse mode (a `formula`,
     `error` or `richText` cell is `CELL_INVALID`). A money cell is text
     matching the `money` pattern, or a number: a negative number is
     `AMOUNT_INVALID`; otherwise it is scaled by 100 and, within 0.01 paise of
     an integer, is that many paise, else `AMOUNT_INVALID` ("two decimal places
     at most"; Excel stores pasted sums as `1234.5600000000002`). A third
     decimal is at least 0.1 paise off, so it is refused, never rounded. A
     number at or above 1e15 paise is refused, matching the text pattern's 13
     rupee digits. Text with a
     thousands separator is refused. A date cell arrives as a `Date` at UTC
     midnight and converts with `toISOString().slice(0, 10)`; a date may also be
     `YYYY-MM-DD` text. Text cells are trimmed. A row with every cell blank is
     skipped. Each header names a template column; an unknown, missing required
     or repeated header is refused, as is a nonblank cell below a blank header
     or an unknown or repeated sheet (`SHEET_REPEATED`). A sheet holds at most
     5,000 data rows (`MASTER_LIST_LIMIT`); a populated row past
     Excel row 5,001 is `SHEET_TOO_LARGE`. Read the complete sheet, without
     `maxRows`: blank XML rows count toward that parser limit and can hide
     later balances. Sparse parsing never builds a dense grid. A workbook with
     more than 20 MiB per decompressed ZIP entry is `WORKBOOK_INVALID`; that
     bound also caps a sheet's stored cells. Nothing is truncated.

   - **Opening Balance accounts.** Trial balance rows resolve through
     `journalAccounts` with `controls` false, plus the two control rows: a GST
     or advance account row is `ACCOUNT_INVALID`, and a `taxable` income row
     on a registered Organization is `TAXABLE_ACCOUNT_LINE`. A legacy GST or
     advance balance goes to a leaf the CA names in `Accounts` (for example
     `GST payable at cutover` under Current Liabilities) and is cleared by
     Journal; a mid-year cutover carries year-to-date income and expense rows
     into their leaves, taxable income into such a leaf. From D4, GST
     balances may sit on the GST system accounts at cutover and Journals clear
     them. The 100-line cap
     of `openingBalance.post` belongs to the form; the import's Opening
     Balance is bounded by the sheet's 5,000 rows.

   - **Resolution.** An account reference is an existing active account's
     code, else its name (case-insensitive), else an `Accounts` row's name. A
     Party reference is a normalized name matched against `Parties` rows and
     existing Parties; no match or more than one is an error. The import never
     updates a master: a name that already exists is an error
     (`PARTY_NAME_COLLISION` without the namesake confirmation,
     `ACCOUNT_NAME_TAKEN`, `ITEM_NAME_TAKEN`), as is `PARTY_GSTIN_TAKEN`.
   - **Balances.** Trial balance debits equal credits (`TRIAL_BALANCE_UNEQUAL`).
     Whenever the trial balance or opening items sheet has rows, each control
     row's signed net must equal its derived net (`OPENING_ITEMS_MISMATCH`,
     naming both figures); a missing control row and an empty items sheet
     each count as zero, so a control balance without items is refused. Party
     balances are therefore checked at their control, as a CA ties AR and AP
     to the legacy trial balance. Control rows name the accounts by code or
     name (`1300 Accounts Receivable`, `2000 Accounts Payable` in the
     templates).
   - **Errors.** `{ sheet, row, column, code, message }`, with the Excel row
     number, or `row` and `column` null for a workbook or balance error,
     sorted by sheet order and row; the first 500 are returned with the total
     count. Codes beyond those named above: `CELL_REQUIRED`, `DATE_INVALID`,
     `HEADER_UNKNOWN`, `HEADER_MISSING`, `HEADER_REPEATED`, `SHEET_UNKNOWN`,
     `ROW_EXTRA`, `DUE_DATE_INVALID`, `ITEM_REPEATED`, `ITEM_DATE_AFTER_OPENING`,
     `ACCOUNT_UNKNOWN`, `PARTY_UNKNOWN`, `PARTY_AMBIGUOUS`, `PARTY_INACTIVE`, and
     `TRIAL_BALANCE_EMPTY` when the Opening Balance would have no line.
   - **Procedures** (`import` router; grant
     `{ account: create, party: create, item: create, openingBalance: post }`,
     which owner and accountant hold). `import.template()` returns the empty
     workbook as a File. `import.check({ file })` returns
     `{ errors, errorCount, summary }` and writes nothing; it exists because
     committed masters cannot be deleted, shares `validateImport` with
     `commit` and stores nothing. `import.commit({ file })`
     reads settings `FOR UPDATE` (as the Opening Balance post does), runs the
     same validation inside one transaction, then writes accounts, parties,
     items, the Opening Balance with its control legs and the opening items,
     in that order. Validation assigns each new master its id, so later rows
     reference it before it is written. Any error is `BAD_REQUEST`
     `IMPORT_INVALID` and rolls everything back; `check` lists the errors. A posted
     Opening Balance with a non-empty trial balance or items sheet is
     `CONFLICT`. `summary` is
     `{ accounts, parties, items, trialBalanceRows, openingClaims, openingCredits, debitPaise, creditPaise, receivablesPaise, payablesPaise }`.
     One audit row `import.commit` carries the summary, never row data.
     HTTP `check` and `commit` allow the 5 MiB file plus 64 KiB of multipart
     overhead; all other procedure bodies keep their 1 MiB limit.
     `import.template`, `import.check` and `import.commit` stay out of oRPC
     batching, as exports do (`apps/web/src/lib/orpc.ts`): a batch cannot
     carry a File either way.
   - **Shared writers** (`packages/api/src/core/masters.ts`).
     `createParties(tx, orgId, fields[], allowNamesake)` and
     `createAccounts(tx, orgId, inputs[])` serve both the routers and import;
     Items resolve account ids and tax codes once through `itemValues`.
     Inserts use batches of 1,000. `claimParties` serializes an Organization's
     party writers with one advisory lock, then checks name and GSTIN
     collisions; one lock keeps a 5,000-party import inside PostgreSQL's shared
     lock table.
     Account code allocation and Item eligibility have one shared policy owner.
     The import passes `allowNamesake` false and maps created ids by name,
     without relying on `RETURNING` row order.
     The workbook reader and template stay in `lib/import-workbook.ts`;
     `core/import-plan.ts` owns database validation and the write plan.
     Validation fetches only referenced Party names/GSTINs and incoming Item
     names; empty reference sets skip those reads.

   **7a. Opening items, control legs and settlement** (riskiest: the ledger
   invariant). Implemented. Each item type's series, in the cutover's financial
   year, reserves its numbers with one `reserveNumbers` statement, and the items
   insert already posted, in batches of 1,000, as do document lines, so a full
   trial balance stays below PostgreSQL's parameter limit. Opening items store
   the financial year used by their number series. Settlement writes
   invalidate the opening-item balances; opening cancellation invalidates party
   reads as well as account balances and reports.
   - Scope: the two document types (schema, `documents_type_check`, the
     party and side check, the `OC` and `OA` series), their posting and cancellation,
     the control legs, the settlement and picker rules, the Payment
     `documentId` rename, statement labels, `openingBalance.items` and
     their list on Settings > Opening balance, and `import.commit` reading
     the `Read me`, `Opening`, `Trial balance` and `Opening items` sheets.
   - Acceptance, on a proprietorship Organization with Parties Priya and
     Mehta Traders created first: a workbook with opening date 31 March
     2026; trial balance `Cash in Hand` 20,000 Dr, `Accounts Receivable`
     8,000 Dr, `Accounts Payable` 5,000 Cr, `Capital Account` 23,000 Cr; items
     Priya claim `INV-88` 10,000 dated 10 February due 12 March, Priya credit
     `ADV-3` 2,000, Mehta payable claim `B-17` 5,000 due 30 April. After
     commit: for every account on the sheet, `sum(debit) - sum(credit)` over
     its journal lines equals the sheet (computed in the test; 7a does not
     depend on 6a's `report.trialBalance`); Priya's
     statement is 8,000 and Mehta's −5,000; Priya's open items list `INV-88`
     at 10,000 due 12 March and her open credits `ADV-3` at 2,000; applying
     `ADV-3` leaves 8,000 outstanding and writes no journal entry; a Receipt
     `against` `INV-88` for 8,000 and a Payment `against` `B-17` for 5,000
     settle both; the Opening Balance refuses cancel while any of those
     allocations is active; after the Receipt and Payment are cancelled
     (reversing their allocations) and the `ADV-3` application is reversed, it
     cancels and every party and control balance is zero. Failure path: the same workbook with
     `Accounts Receivable` 7,000 (and `Capital Account` 22,000, so it still
     balances) is `IMPORT_INVALID` (`OPENING_ITEMS_MISMATCH`) and
     leaves the document, party ledger and journal counts unchanged; a
     second commit while the Opening Balance is posted is `CONFLICT`.
   - Verify: new `tests/integration/import.test.ts` (the workbook built with
     `writeXlsx`); `tests/integration/allocation.test.ts` and
     `payment.test.ts` for the Payment rename; `GUARDED_CALLS`;
     `bun run db:generate` and the baseline rule 4; `bun run check-types`;
     Settings > Opening balance in the app at 1440 and 390 px in both themes.
   - Depends on: none. Shares `core/allocations.ts`, `lib/settlements.ts`,
     `routers/receipt.ts`, `routers/payment.ts` and the Receipt and Payment
     forms with 9b, which is implemented: 7a extends its target rule
     (a Journal debit is a receivable target for its party).
   - Owns: `packages/db/src/schema/documents.ts`,
     `packages/api/src/core/opening-items.ts` (new: post and reverse),
     `packages/api/src/core/entry-lines.ts` (control legs),
     `packages/api/src/routers/opening-balance.ts`,
     `packages/api/src/routers/import.ts` (new),
     `packages/api/src/lib/import-workbook.ts` (new: read and validate),
     `packages/api/src/core/allocations.ts` (`roleOf`),
     `packages/api/src/lib/settlements.ts` (pickers),
     `packages/api/src/routers/receipt.ts`,
     `packages/api/src/routers/payment.ts`,
     `apps/web/src/components/receipt-form.tsx`,
     `apps/web/src/components/payment-form.tsx`,
     `apps/web/src/components/allocation-table.tsx`,
     `apps/web/src/routes/$orgSlug/settings/opening-balance.tsx`,
     `tests/integration/import.test.ts`. Touches:
     `packages/api/src/routers/party.ts` (labels, Transactions),
     `packages/api/src/routers/index.ts`, `apps/web/src/lib/orpc.ts`,
     `tests/integration/tenancy.test.ts`.
   - Interfaces: `postOpening(tx, scope, settings, { documentDate, lines, items })`
     in `core/opening-items.ts` posts the Opening Balance with control legs
     and the items; `items` are
     `{ partyId, side, type: "openingClaim" | "openingCredit", reference, documentDate, dueDate, amountPaise }`.
     Items do not go through `postDocument`, which requires lines, records an
     entry and dates the ledger line by `documentDate`. `postOpening` posts
     the Opening Balance through `postEntryLines` on the import-only path,
     then reserves each series' numbers in one statement and, for each item,
     inserts a posted, numbered `documents` row with `partyId`,
     `exposureSide`, `reference`, `dueDate` and `totalPaise`, and its one
     `post` party ledger line with `entryDate` the Opening Balance
     `documentDate` (the row `settlementPaise` reads). The period lock is checked once, for the Opening Balance
     on the cutover date. `openingBalance.cancel` checks active allocations on
     the items' ids before `reverseDocument` changes any state.
     `readImportWorkbook(file)` returns parsed sheets and cell errors;
     `validateImport(tx | db, orgId, settings, read)` takes the reader's
     result, refuses opening data beside a posted Opening Balance, and returns
     `{ errors, errorCount, summary, plan }`, and `commit` writes `plan`.
     Picker rows gain `reference: string | null`.

   **7b. Masters, template and check.** Implemented. Validation assigns each
   new master its id, so a plan references existing and new masters by id.
   - Scope: the `Accounts`, `Parties` and `Items` sheets with the
     resolution rules; `import.template` and `import.check`; the shared
     writers extracted and used by their routers.
   - Acceptance: a workbook creating `Tuition Fees` (income, `exempt`), Priya
     (customer, State code 27) and an Item on `Tuition Fees`, plus the 7a
     balances naming Priya, checks clean and commits in one call; the
     template round-trips through `import.check` with no errors. Failure
     path: the same workbook with Priya's name already taken and an Item on
     an unknown account returns both errors with sheet, row and column from
     `import.check`, and `import.commit` writes nothing.
   - Verify: `tests/integration/import.test.ts` extended;
     `tests/integration/account.test.ts` and the party tests unchanged and
     green after the extraction; `GUARDED_CALLS`; `bun run check-types`.
   - Depends on: 7a. Owns: `packages/api/src/lib/import-workbook.ts`,
     `packages/api/src/routers/import.ts`, `tests/integration/import.test.ts`.
     Touches: `packages/api/src/routers/party.ts`, `account.ts`, `item.ts`
     and the new `packages/api/src/core/masters.ts` for `createParty` and
     `createAccount`.

   **7c. Import page.** Implemented. The Opening Balance page lists the items;
   an open opening claim's row offers Apply credit (the Invoice dialog), so an
   opening credit can settle it without a later document.
   - Settings > Import (`routes/$orgSlug/settings/import.tsx`, the owner
     client-patterns names): Download template; choose a file; Check lists
     the errors (Sheet, Row, Column, Message, with the total when above 500)
     or the summary (counts, trial balance totals, receivable and payable
     nets). Import is enabled only after a clean Check of the chosen file;
     choosing another file clears it. Success shows the summary with links to
     Opening balance and Parties and invalidates the master, settlement and
     settings queries. Visible to members holding the `import` router's grant.
   - Acceptance: the 7b workbook imports from the page; a workbook with one
     bad row shows its error and imports nothing.
   - Verify: `bun run check-types`; the page exercised in the app at 1440 and
     390 px in both themes, including the error table.
   - Depends on: 7b. Owns: `apps/web/src/routes/$orgSlug/settings/import.tsx`.
     Touches: the settings navigation and `apps/web/src/lib/domain-invalidation.ts`.

   **7d. Tally source.** Gated: not built until the release gate below is
   met. Source chosen 2026-10-02: TallyPrime first, Zoho Books waits for a
   pilot on it
   ([evidence](../research/tally-import-source-2026-10-02.md)). Most Indian
   books live in Tally, and one native file carries what the workbook needs:
   Alt+E > Masters > All Masters, XML, Default (All Languages), with
   "Export closing balance as opening balance" at the cutover date. Zoho
   needs several module CSVs plus AR ageing, and no export of historical
   payables or unmatched credits was verified.
   - Shape: `import.check` and `import.commit` take either the template
     `.xlsx` or a Tally `.xml` (5 MiB cap as the workbook) plus, for XML,
     `openingDate`, since the export does not carry its closing date.
     `readTallyMasters(bytes, openingDate)` returns the parsed workbook
     `readImportWorkbook` returns, so `validateImport`, the plan and the
     commit are unchanged. Its own errors use the workbook error shape with
     `sheet` the master kind (`Groups`, `Ledgers`, `Stock items`), `row`
     null and the message naming the Tally master.
   - Reading: BOM-detected UTF-8 or UTF-16 (LE or BE); `LEDGER`, `GROUP`
     and `STOCKITEM` under any `TALLYMESSAGE`; amounts negative for debit;
     `YYYYMMDD` dates. Aliases are not masters.
   - Groups: a custom group maps through its reserved ancestor. Bank
     Accounts → `Bank Accounts`; Cash-in-hand → `Cash`; Current Assets,
     Deposits (Asset), Loans & Advances (Asset), Stock-in-hand →
     `Current Assets`; Fixed Assets, Investments, Misc. Expenses (ASSET) →
     Assets; Current Liabilities, Duties & Taxes, Provisions →
     `Current Liabilities`; Loans (Liability), Secured Loans, Unsecured Loans, Bank
     OD A/c → Liabilities; Capital Account, Reserves & Surplus and the
     `Profit & Loss A/c` ledger → Equity; Sales Accounts, Direct and
     Indirect Incomes → Income; Purchase Accounts, Direct and Indirect
     Expenses → Expenses. Branch/Divisions and Suspense A/c are
     `TALLY_GROUP_UNSUPPORTED`: the CA regroups them in Tally first.
   - Ledgers: one under Sundry Debtors is a `Parties` row with role
     customer, under Sundry Creditors supplier, with `PARTYGSTIN` (else the
     last `LEDGSTREGDETAILS.LIST` GSTIN), `INCOMETAXNUMBER`, `LEDSTATENAME`
     as its State code, `ADDRESS.LIST` lines joined, `PINCODE`, `EMAIL` and
     `LEDGERMOBILE` else `LEDGERPHONE`. Its `BILLALLOCATIONS.LIST` rows are
     opening items: under debtors a debit is a receivable claim and a credit
     a receivable credit; under creditors a credit is a payable claim and a
     debit a payable credit. `NAME` is the Reference, `BILLDATE` the Date,
     and a `BILLCREDITPERIOD` of whole days gives the Due date. A party
     whose allocations do not sum to its balance (bill-wise off, or an On
     Account residual) is `TALLY_BILLS_MISMATCH`. The party balances become
     the `receivables` and `payables` trial balance rows. Every other
     ledger is an `Accounts` row under its mapped parent plus a `Trial
balance` row for a non-zero balance; a name matching an existing
     account maps to it instead. A non-zero income or expense balance is
     `TALLY_MID_YEAR`: 7d supports a financial-year-boundary cutover until a
     mid-year export is checked.
   - Stock items: an `Items` row with HSN, the GST rate as of the opening
     date as its Tax code, unit price zero (a Tally valuation rate is not a
     selling price), and the Income account the only Sales Accounts ledger,
     else `ITEM_ACCOUNT_REQUIRED`. Opening stock value stays a trial
     balance figure; quantities are not imported.
   - Refused: a foreign-currency ledger (`TALLY_CURRENCY_UNSUPPORTED`).
     Cost centres are not carried, and the summary says so.
   - Release gate: an anonymized native export from a pilot's Tally at a
     year boundary, including a part-paid invoice, a supplier bill, an
     advance, an On Account residual and a Unicode name, checked against
     that company's trial balance and outstanding reports as at the cutover.
     The mapping above follows Tally's documentation and a third-party
     loader's schema; whether closing-as-opening keeps part-paid residuals,
     due dates and advance flags is unverified, and the fixture confirms or
     corrects every rule before code is written.
   - Acceptance: a Tally XML fixture of the 7a figures (Priya under Sundry
     Debtors with `INV-88` and `ADV-3`, Mehta Traders under Sundry
     Creditors with `B-17`, Cash and Capital ledgers) checks to the same
     summary as the 7a workbook and commits the same balances; the same
     file with `ADV-3` removed is `TALLY_BILLS_MISMATCH` and writes nothing.
   - Depends on: 7b, and 7c for the page's opening date. Owns:
     `packages/api/src/lib/tally-masters.ts` (new). Touches:
     `packages/api/src/routers/import.ts`, the import page and
     `tests/integration/import.test.ts`.

8. **Chart of accounts.** Implemented. Owner and accountant manage posting leaves across
   Assets, Liabilities, Equity, Income and Expenses. Templates establish the
   groups and protected control accounts.
   - `account.create` takes `name`, `parent` and optional `supplyClass`.
     `parent: { type }` places a leaf at that type's root;
     `parent: { accountId }` selects an active, same-organization group and
     derives the type from it. A group already has children; posting leaves
     cannot become parents. A foreign parent is `NOT_FOUND`.
   - Income requires `supplyClass`; other types refuse it (`BAD_REQUEST`).
     Codes are generated after the highest existing code in the applicable
     range: assets 1200–1999, liabilities 2000–2999, equity 3001–3999, income
     5000–5999 and expenses 6000–6799. Templates reserve 3000 and 6800–6999.
     Cash and bank children retain their group's 99-code range. Exhaustion is
     `ACCOUNT_CODES_FULL`; a concurrent code collision is `CONFLICT`.
   - A case-insensitive duplicate active account name is
     `ACCOUNT_NAME_TAKEN`, enforced by a partial unique index on the active
     rows' `lower(name)`; restoring an archived account whose name is now taken
     is refused the same way.
   - `account.update({ accountId, name, updatedAt })` renames an account;
     `updatedAt` is a millisecond-precision edit token (`CONFLICT` when stale).
   - `account.setActive({ accountId, active })` archives or restores a leaf without a
     `systemKey`. Refused: a group or system account (`ACCOUNT_SYSTEM`), an
     income leaf held by an active Item, and a money leaf held by an active
     Payment Method (`ACCOUNT_IN_USE`, naming them). An archived account keeps
     its lines and balance and leaves every picker: `postableAccounts`,
     `journalAccounts` and `incomeAccountOptions` already filter `active`.
     Archiving locks the account row through the dependent checks and update.
     Item and Payment Method creation and every posting hold a shared lock on
     each referenced account until their writes commit. Restoring an Item or
     Payment Method does not check its account, as in ERPNext and Zoho Books:
     posting to an archived account is refused.
   - `supplyClass` never changes after creation: posted lines took their tax
     treatment from it. A wrong class is archived and recreated.
   - Every new organization's core template includes `6810 Discount Allowed`
     and `6820 Bad Debts Written Off` for slice 9.
   - Web: Accounting > Chart of accounts shows desktop columns Name, Parent
     ledger, Code and Type. Mobile cards also show the GST supply class when
     present. Only archived rows show an Inactive badge. New account picks its
     parent from a `NativeSelect` grouped by type (a type's top level or an
     existing group), then Name, and GST supply class for income. For editors,
     each row opens its Rename Sheet (`?edit=`); Mark inactive / Mark active is
     a button in that Sheet for posting leaves, as for Parties and Items.
     Read-only rows have no edit link. Banking's Add account
     opens that same Sheet in Banking under Bank Accounts, then continues to Add
     payment method with the new account chosen.
   - Acceptance: an accountant creates `Tuition Fees` (income, `exempt`) and
     `Sibling Discount` (expense); the first appears in the Item income
     picker and the second in the Journal account picker; a rename shows on
     the next list; archiving `Sibling Discount` removes it from the Journal
     picker and keeps its balance; archiving `Tuition Fees` is refused once an
     Item uses it; an operator's create is `FORBIDDEN`.
   - Verify: `tests/integration/account.test.ts`, the money-account workflow
     in `tests/integration/receipt.test.ts`, and the guarded-call table in
     `tests/integration/tenancy.test.ts`; `bun run check-types`; the Sheet
     exercised in the app on desktop and mobile, both themes. Parent validation
     rejects foreign and posting-leaf parents; control accounts are not offered.
   - Depends on: none. Owns: `packages/api/src/routers/account.ts`,
     `packages/api/src/core/chart-templates.ts`,
     `apps/web/src/routes/$orgSlug/accounts.tsx`,
     `apps/web/src/components/account-sheet.tsx` and
     `apps/web/src/components/account-columns.tsx`.
   - Interfaces: `account.create` returns the inserted row. Slice 9's picker
     reads `journal.accounts`.
9. **Party Journals.** In two parts, after slice 8; both are implemented. A Journal line on a
   party control account carries a required Party and writes the party ledger,
   so the sum of party statements equals the control account by construction.
   ERPNext's `Party Type` and `Party` on a Journal Entry row and Tally's party
   ledger do the same. The Journal stays the escape hatch; the common cases
   keep their document (Invoice header discount and Credit Note in 4b-ii,
   Receipt `against`), and the form says so.

   **9a. Receivables lines and Journal credits.** Implemented. CA acceptance
   is open.
   - `journalAccounts` takes `controls: boolean` and, when true, adds the
     `receivables` control account with its `systemKey`; Opening Balance
     passes `false`. `payables`, `customerAdvances` and `supplierAdvances`
     stay refused (`ACCOUNT_INVALID`): advance sources are Receipts, payable
     targets are Bills, and each is admitted only with its own settlement rule,
     so a Journal's party ledger line never mixes
     control accounts (call 17). A `receivables` line without `partyId` is
     `PARTY_REQUIRED` (`BAD_REQUEST`), checked in the posting transaction
     after the accounts resolve; elsewhere the party stays optional
     attribution.
   - Side is `receivable`; a debit is positive and a credit negative (Dr
     `receivables` raises what the Party owes). `postDocument` nets the
     `receivables` lines per party and writes one party ledger line each,
     skipping a zero net. That line equals the Journal's capacity for the
     party by construction. `documents.partyId` and `exposureSide` stay null:
     one Journal may touch several parties.
   - A `receivables` credit line may carry `allocations` of
     `{ invoiceId, amount }`, as a Receipt `against` does: each target a posted
     Invoice of that line's party, at most 50 per line, and the total across a
     party's lines at most that party's net `receivables` credit in the
     Journal (a debit and a credit on the same party net first; a total above
     the net is `BAD_REQUEST` `ALLOCATION_EXCEEDS_SOURCE`, and `allocations` on
     a debit or on any other account is `ALLOCATION_TARGET_INVALID`). Posting writes the allocation rows with the
     Journal as source and no journal entry. The unallocated rest is an
     unapplied credit on `receivables`: not an advance, no `advanceSupply`, no
     `customerAdvances`.
   - `allocation.apply` takes `sourceDocumentId`, `targetDocumentId` and
     `amount`; `applyAllocations` reads a Journal's capacity as its net
     `receivables` credit for the target's party (call 17), the same quantity
     posting capped against, and admits a posted Journal with such a credit.
     Applying or reversing from a Journal writes no entry.
     `party.openCredits({ partyId, side: "receivable", type? })` lists
     Journals with unapplied credit for the party alongside Receipts and
     Credit Notes, in the same 25-row keyset pages with `hasMore`; `type`
     accepts `journal`.
   - Cancel: `reverseDocument` already reverses party ledger lines; a Journal
     cancel appends reverse rows for its active allocations with no entry, as
     Receipt cancel does.
   - Web: the Journal line's Party field turns required when the account is
     `receivables`, with the hint "Changes what this party owes"; a
     `receivables` credit line shows the Receipt form's open invoices grid
     (the shared `AllocationTable`). Journal detail lists lines with their
     party and the shared Allocations section with Reverse. The party Ledger
     links a Journal line to its record as it links Receipts. Apply credit
     lists Journal credits. The Opening Balance picker hides `receivables`.
   - Acceptance, with Priya owing a ₹10,000 Invoice: a Journal
     Dr `Sibling Discount` 500 / Cr `receivables` (Priya) 500 allocated to
     that Invoice leaves outstanding 9,500, statement balance 9,500, one day
     book entry, and `receivables` down by 500 in journal lines; the same
     Journal without an allocation leaves outstanding 10,000, balance 9,500
     and an open credit of 500 that Apply credit settles with no new entry; a
     control line without a party is `PARTY_REQUIRED`;
     Dr `receivables` (Rahul) / Cr `receivables` (Priya) 2,000 moves the
     statements and leaves `receivables` unchanged; cancelling each Journal
     restores every figure; Opening Balance still refuses control accounts.
   - Verify: `tests/integration/journal.test.ts` and
     `tests/integration/allocation.test.ts` extended per the acceptance;
     `tests/unit/posting.test.ts` for the netting; the guarded-call table for
     `party.openCredits`; `bun run check-types`; the form exercised in the app.
     A Journal writes one party ledger line per party, so `settlementPaise`
     then takes the target's party; re-measure the "Settlement reads at
     volume" registry item.
   - Depends on: slice 8 (the expense leaf) and 4b-ii. Owns:
     `packages/api/src/lib/accounts.ts` (`journalAccounts`),
     `packages/api/src/core/posting.ts` (`JournalLinePosting`),
     `packages/api/src/core/documents.ts` (Journal party lines),
     `packages/api/src/core/allocations.ts`,
     `packages/api/src/routers/journal.ts`, `allocation.ts`, `party.ts`,
     `receipt.ts`, `apps/web/src/components/journal-form.tsx`,
     `apply-credit-dialog.tsx`,
     `apps/web/src/routes/$orgSlug/journals_.$journalId.tsx`. Touches:
     `apps/web/src/routes/$orgSlug/invoices/$invoiceId.tsx` (the Sheet's name
     and query), `apps/web/src/lib/domain-invalidation.ts`,
     `tests/integration/tenancy.test.ts`.
   - Interfaces: `JournalLinePosting` gains `systemKey` (nullable) and
     `allocations` (`AllocationTarget[]`, empty except on a `receivables`
     credit); `applyAllocations` keeps its argument shape and widens its
     source rule; `party.openCredits` keeps its Receipt and Credit Note rows
     and adds Journal rows for the receivable side:
     `{ id, type: "journal", number, documentDate, unappliedPaise }`.

   **9b. Journal debits as open items.** Implemented. CA acceptance is open.
   A Journal netting to a `receivables` debit for a party (the Rahul side of
   a transfer, a charge with no Invoice) is a settlement target for that
   party: its capacity is its positive `post` party ledger line for the
   party, and its outstanding counts only applies from sources of that party.
   Receipt `against` and `allocation.apply` from a Receipt or Credit Note may
   target it; a Journal credit still targets Invoices only, and a Journal
   with no debit for the source's party is `ALLOCATION_TARGET_INVALID`.
   Receipt `allocations` take `{ documentId, amount }`.
   `party.openItems({ partyId, side: "receivable" })` lists Journal debits
   with Invoices and refund Payments, in the same oldest-first pages, with
   `dueDate` null for a Journal. Invoice list open and overdue filters stay
   Invoice-only. A Journal with active allocations targeting it refuses
   cancel (`CONFLICT`, naming the sources), as an Invoice does. The Receipt
   form's Open items grid shows type and number.
   - Acceptance: after the sibling transfer, a Receipt `against` Rahul settles
     the 2,000 Journal debit; Rahul's balance and `receivables` both fall by
     2,000; the Journal refuses cancel until that allocation is reversed; a
     Receipt against Priya cannot target it. Covered by
     `tests/integration/journal.test.ts`.
   - Interfaces: `party.openItems` rows are
     `{ id, type: "invoice" | "payment" | "journal", number, documentDate, dueDate, outstandingPaise }`.

## Journal, Opening Balance and locks (slice 5)

Implemented. The [original-cutover correction policy](../research/opening-balance-correction-policy-2026-09-22.md)
explains the Opening Balance exception. CA acceptance is open; party lines are
slice 9.

- **Document.** Type `journal`, a Billing document like Receipt, posted in full
  with no draft. Header: `documentDate`, a required `narration` (1–500), an
  optional `reference` (120), and `totalPaise` as the debit total. Party,
  method, settlement fields and the print snapshot stay null.
- **Lines.** 2 to 100. Each has `accountId`, `side` (`debit` or `credit`),
  `amountPaise` above 0, an optional `partyId` (attribution, and required on
  a control account from slice 9a) and an optional `description`. From slice
  9a a `receivables` credit line may carry `allocations`. At least one debit
  and one credit; the totals are equal. The router refuses bad input as
  `BAD_REQUEST` before the core.
- **Accounts.** Any active leaf, money leaves included. Refused: groups, GST
  input, output and cess accounts (admitted from D4), and `taxable` income when the Organization
  has a `gstin` (the call 16 guard). The party control accounts
  (`receivables`, `payables`, `customerAdvances`, `supplierAdvances`) are
  refused; slice 9a admits `receivables` with a required Party and keeps the
  other three refused. Opening Balance
  keeps refusing them. Thus `affectsTax` is false, and a Journal writes party
  ledger lines only for its `receivables` lines. The batch predicate `journalAccounts`
  runs inside the posting transaction after a `FOR SHARE` read of
  `organization_settings`, so a concurrent GSTIN change cannot let a taxable
  line through. It is beside `postableAccounts` in `lib/accounts.ts` and reuses
  `isLeaf`.
- **Storage.** The baseline migration carries: nullable `entry_side` (`debit`,
  `credit`) and `party_id` (composite key to `parties`) on `document_lines`,
  `journal_prefix`, `locked_through` and `tax_locked_through` on `organization_settings`, `period_locks`,
  `lock_exceptions`, and the partial unique index
  `documents_org_opening_balance_idx` on posted Opening Balance documents.
  An entry line's `amount_paise` is positive; its side is `entry_side`. The
  ledger derives from these lines. Baseline regeneration follows
  [Development](../development.md#code-rules).
- **Posting.** `JournalPosting` and `OpeningBalancePosting` are
  `DocumentPosting` variants built from one entry-line shape. A pure
  `postJournal` checks the lines, and `recordEntry` uses a switch.
- **Write path and number.** `postEntryLines` shares account validation and line
  preparation between Journal and Opening Balance, then calls `postDocument`.
  Input line fields and the balance refinement live in `lib/schemas.ts`.
  A `journalPrefix` setting (default `JV` via `SETTINGS_DEFAULTS`, the
  `documentPrefix` rule) produces `JV26-27/1`.
- **Cancel.** Journal cancellation uses `reverseDocument`: once, with a reason,
  dated the cancel day. A wrong date is fixed by a new Journal, not by editing.
  Opening Balance uses the original-cutover rule below.
- **Contra** is a label for a Journal whose lines are all money leaves (bank to
  bank, a cash deposit). One type, one series.
- **Wiring.** The `journal.{post,get,list,accounts,cancel}` procedures have
  their own get and list (not `settlementDetail`), the tenancy guarded-call
  table, a nav entry with `journal: ["read"]`, and audit on post and cancel.
  `journal.accounts` returns pickable accounts: active non-system leaves plus
  the four journalable system accounts (`tdsPayable`, `tdsReceivable`,
  `roundOff`, `openingEquity`), bounded by `MASTER_LIST_LIMIT`, and minus
  `taxable` income when the Organization has a `gstin`. Opening Balance uses
  this same picker and cache key, including settings-change invalidation.
  A taxable account line
  is refused as `TAXABLE_ACCOUNT_LINE`, an
  unresolvable account as `ACCOUNT_INVALID`, and a foreign party as
  `PARTY_INVALID`. The day book and `account.moneyBalances` read journal
  entries.
- **Opening Balance.** Type `openingBalance`, one posted per Organization
  (partial unique index `documents_org_opening_balance_idx`; a second post is
  `CONFLICT` until the first is cancelled; the post takes the settings row
  `FOR UPDATE` so concurrent posts serialize), fixed `OB` prefix
  (`OB26-27/1`), `documentDate` is the "as at" date, the day before the first
  operational entry, narration `Opening balances`,
  lines as the Journal minus party; the control accounts stay refused. A complete balanced
  trial balance needs no `openingEquity` line; any opening-equity amount is an
  explicit line the user enters, never a silent plug.
  `affectsTax` false, no party ledger lines. Cancellation via `reverseDocument`
  posts an opposite entry on the original `documentDate` and checks that date's lock;
  refusal rolls back the cancellation. The original and reversal remain
  auditable. A replacement can use the same date, subject to normal posting
  locks; there is no separate replacement-after-reversal cutoff.
  `openingBalance.get` returns the posted document or null.
- **Locks.** `organization_settings.lockedThrough` and `taxLockedThrough` own
  the current dates; null means unlocked. `lock.set` reads settings `FOR UPDATE`
  and compares `expectedLockedThrough`; missing settings is an integrity failure,
  while a stale date is `CONFLICT`. A fresh value deliberately permits reopening
  with an earlier date or null. The update appends its `period_locks` history row
  `{ kind: general | tax, lockedThrough | null, reason, createdBy }` atomically.
  History's highest identity id per kind supplies the latest reason and setter
  to the settings screen, not a posting-time lookup. `lock_exceptions` stores
  `{ userId, expiresAt, reason, grantedBy, revokedAt/revokedBy }`;
  active means not revoked and not expired on the database clock.
  Every posting, cancellation and allocation reads settings once `FOR SHARE` (or stronger)
  inside its transaction, before document locks. `lock.set` and
  `lock.revokeException` take `FOR UPDATE` and wait for those readers to commit.
  `assertPeriodOpen` checks those already-held dates and queries exceptions only
  for a general-lock bypass. It runs in `postDocument` (document date),
  `reverseDocument` (reversal date) and allocations (entry date):
  `LOCKED` (`BAD_REQUEST`) when the date is on or before the general lock and
  the caller holds no active exception, or on or before the tax lock and the
  entry `affectsTax`. Procedures and permissions: `lock.get` (`lock:read` —
  owner, accountant, ca), `lock.set` (`lock:set` — owner, ca),
  `lock.grantException`/`lock.revokeException` (`lock:grantException` — owner,
  ca; `EXPIRY_PAST`, `MEMBER_INVALID`, revoke of an inactive row is
  `CONFLICT`); all three mutations audited. Revoke takes no reason, only a
  confirmation: an exception expires by itself, and Zoho Books asks only for
  confirmation to end a partial unlock. Web: Settings > Opening balance
  (form when none is posted, record with Cancel when one is) and Settings >
  Locks (both locks with Change, exceptions with Grant and Revoke); forms show
  `LOCKED` on the date field. Change and Grant are URL-backed Dialogs; Change
  requires a loaded lock state. Switching Organization or lock kind starts a
  fresh form; a refetch preserves the original expected lock date for CAS.
  Expiry retains minute-precision local time in the Organization zone and rejects
  nonexistent DST times instead of shifting them. Exceptions are
  user-scoped until revoked or expired: removing membership denies all access,
  but re-admitting the same user does not revoke a still-live grant.

| Not in the first Journal               | Gate                                                              |
| -------------------------------------- | ----------------------------------------------------------------- |
| Line tax (GST accounts arrive with D4) | The monthly GST-on-fee reclass gate                               |
| Drafts and approval                    | Slice 4a drafts proven; more posters than reviewers               |
| Recurring, templates, auto-reversal    | One Journal posted three months running, or a CA accrual workflow |
| A Contra series or a Transfer document | The CA asks, or bank reconciliation opens                         |
| Multi-currency, inter-company          | Their own spec; two live Organizations for one owner              |
| Print, attachments, cost centres       | The CA asks, or a pilot report needs one                          |

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
- **TDS thresholds, amount overrides and the no-PAN rate** (§397(2)). A
  Payment `against` Bills takes no TDS; the Bill deducts at credit. An advance
  Payment with TDS followed by a Bill with TDS is not netted: the accountant
  reconciles by Journal. Gate for thresholds, overrides and the no-PAN rate:
  the first pilot case.
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
- **GSTR-1 Table 13.** Gate: a CA asks.
- **Account-scoped lock exceptions.** Gate: a CA states the rule.
- **A filed-return record.** The CA moves the tax lock with `lock.set` when a
  return is filed; that is how locks follow filed returns. A "mark GSTR-1 or
  3B filed" action, as in Zoho Books or India Compliance's
  `restrict_changes_after_gstr_1`, arrives with GST return preparation.
- **GST treatment on Party** (registered, composition, SEZ, overseas,
  unregistered, consumer). Today a GSTIN decides B2B. Gate: the first SEZ,
  export or composition Party, together with the GSTR-1 tables and LUT rules
  that need it. The backfill is derivable from `gstin`.
- **An Invoice Write Off action.** A bad debt is a slice 9a Journal: Dr
  `Bad Debts Written Off`, Cr `receivables` allocated to the Invoice. Gate:
  the CA writes off Invoices every month after slice 9a.
- **Identity beyond one registration.** Document currency, a GSTIN per
  document (several registrations under one PAN) and accounting dimensions
  are nullable columns added with their own spec, so no backfill waits on
  them. Gates: multi-currency's spec; a pilot Organization with a second
  GSTIN; cost centres as in the Journal table.
- **A time-zone setting.** Gate: the first Organization outside India.
- **Lock history view.** The rows exist; a list arrives when a CA asks.
- **Year-end close.** Gate: the first pilot year end.
- **Statutory statements** (Schedule III layout, current and non-current
  split, notes). Slice 6 prints management statements from the chart. Gate: a
  CA asks for statutory accounts from Accly.
- **Comparative and monthly report columns, ageing buckets, cash-basis
  reports.** Gate: a pilot CA asks for one.
- **Report pagination or streaming** beyond the slice 6 line bounds. Gate: a
  detail report hits `REPORT_TOO_LARGE` on a period a CA needs.
- **Import updating existing masters, and Payment Method import.** Gate: a
  second cutover for one Organization, or a pilot with more than a handful of
  methods.
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

## Decisions (2026-10-04)

The open questions and the design choices behind the
[walkthrough findings](../research/docs-walkthrough-findings-2026-10-04.md) are settled
here from ERPNext v15 (source and docs) and Zoho Books India help. Where the two
differ, the simpler rule wins; where this model differs from both, the row says why.
Each row is a build item until its code lands; the
[work registry](../README.md#work-lifecycle) tracks them. Revisit any row with the CA.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Basis                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Every document reverses on its own date**, not today: a cancellation or amend writes its reversal dated the original `documentDate`, as the Opening Balance already does (call 7). The lock check therefore runs on the original date, so a document in a locked period cannot be cancelled or amended without an exception (books lock) or a reopened tax lock. Correct a filed invoice with a credit note. Ledger rows stay append-only; `cancelledAt` keeps the real instant. This closes findings M1 and the stale bank balance of a last-month cancel. | ERPNext default (Immutable Ledger off) reverses on the original posting date and `check_freezing_date` blocks the cancel; Zoho's lock blocks modifying locked-period transactions.        |
| D2  | **An allocation is dated the later of its source and target document dates**, with no date field. Its reverse takes the same date. Both check the lock on that date (call 17).                                                                                                                                                                                                                                                                                                                                                                                | ERPNext "Reconciliation Takes Effect On" default computes the later of invoice and advance dates.                                                                                         |
| D3  | **No posting dated on or before a posted Opening Balance's date**, except the Opening Balance and its opening items (`BEFORE_OPENING_BALANCE`).                                                                                                                                                                                                                                                                                                                                                                                                               | Deliberate difference: ERPNext has no cutover date and Zoho re-syncs opening balances after back-dated entries; this model has one cutover entry, so earlier documents would count twice. |
| D4  | **Journals admit the GST ledger accounts** for payment and input-tax set-off (owner and accountant only, as all Journals). Such a line sets `affectsTax`, so the tax lock covers it. GST registers keep reading documents only. The **Opening Balance admits GST accounts** too, for balances at cutover.                                                                                                                                                                                                                                                     | India Compliance records GST payment and ITC set-off as Journal Entries on GST accounts; Zoho's GSTR-3B payment writes an offset journal; neither restricts GST balances in openings.     |
| D5  | **A supplier invoice number is unique per supplier and financial year** among posted, uncancelled Bills (`BILL_NUMBER_TAKEN`). Receipts get no duplicate check.                                                                                                                                                                                                                                                                                                                                                                                               | ERPNext "Check Supplier Invoice Number Uniqueness" (same scope); Zoho blocks a repeated bill number per vendor and year.                                                                  |
| D6  | **A Receipt can refund a supplier**: a `refund` settlement on a vendor's unapplied Debit Notes and Payment advances, mirroring the Payment that refunds Credit Notes.                                                                                                                                                                                                                                                                                                                                                                                         | Zoho Vendor Credits and Payments Made both offer Refund.                                                                                                                                  |
| D7  | **A Debit Note against a Bill with TDS reverses TDS in proportion** to the taxable value it returns.                                                                                                                                                                                                                                                                                                                                                                                                                                                          | ERPNext returns recompute withholding on the negative net total.                                                                                                                          |
| D8  | **Print titles follow the law**: an Invoice prints Tax Invoice or Bill of Supply by call 6 (the current fixed "INVOICE" heading is a bug), and Credit and Debit Notes get a PDF with the Rule 53(1A) particulars and the original invoice number and date.                                                                                                                                                                                                                                                                                                    | CGST s.31, Rules 46, 49 and 53(1A); India Compliance prints Tax Invoice and Credit/Debit Note headings.                                                                                   |
| D9  | **Payment Method stays one name bound to one money account**, with no receipt-only or payment-only flag. The earlier payment-mode question closes without a schema change.                                                                                                                                                                                                                                                                                                                                                                                    | ERPNext Mode of Payment has no direction field; Zoho modes are one shared list.                                                                                                           |
| D10 | **A released credit is an advance of its source document** again: reversing an allocation returns the amount to the source's unapplied balance under its own `advanceSupply` (call 16). It has no tax effect while `taxableService` advances are refused; GST advance documents, when built, re-open the GST adjustment as India Compliance does.                                                                                                                                                                                                             | ERPNext UnReconcile returns the amount as unallocated on the Payment Entry; Zoho adds it back as an Excess Payment credit.                                                                |
| D11 | **Home and Banking balances stop at today's business date in the Organization's time zone**, like the balance sheet: `account.moneyBalances` and `party.balances` bound the ledger's `entry_date`. Future-dated documents stay allowed without a warning; statements keep their requested date range.                                                                                                                                                                                                                                                         | Neither product blocks future accounting dates; bounding the balance removes the Banking versus balance-sheet mismatch.                                                                   |
| D12 | **No negative-cash block or warning**, no future-lock-date block, and inactive parties and accounts may keep a balance (inactive blocks new documents only; reactivate to settle).                                                                                                                                                                                                                                                                                                                                                                            | ERPNext and Zoho allow all three by default.                                                                                                                                              |
| D13 | **GST rates**: GST12 ends 2025-09-21 with the rest of the 12% slab; GST28 stays only for the tobacco goods to 2026-01-31; GST40 starts 2025-09-22. 3%, 0.25% and 1.5% arrive when a pilot sells those goods.                                                                                                                                                                                                                                                                                                                                                  | GST Council press release, September 2025.                                                                                                                                                |
| D14 | **TDS stays half-up to the rupee** per deduction, so deposits by challan (whole rupees) match the ledger.                                                                                                                                                                                                                                                                                                                                                                                                                                                     | No statutory per-deduction rule found; ERPNext offers rupee rounding as an option.                                                                                                        |
| D15 | **Chart templates**: the trust and society "Fees" account is `exempt`, and the professional "Rent Received" is `taxable` (commercial letting). A supply class can change while the account has no posted lines.                                                                                                                                                                                                                                                                                                                                               | Education services are exempt; renting commercial property is taxable.                                                                                                                    |
| D16 | **Small integrity rules**: two document types cannot share a prefix; a GSTIN's check character is validated; payment method names are unique ignoring case. Back-dated documents keep taking the next number (GST requires unique, consecutive numbers per year, not date order).                                                                                                                                                                                                                                                                             | CGST Rule 46(b); ERPNext and Zoho number by creation order.                                                                                                                               |

### CA acceptance

Still open, recorded here with name and date when the CA signs: the call 16 table;
the 13 TDS rows; the management P&L and balance sheet layout, with unclosed profit
split into current and earlier years; opening customer advances and supplier
on-account payments presented as opening credits on `receivables` and `payables`;
and these worked examples, tax excluded: a ₹10,000 advance with ₹4,000 applied to a
₹6,000 Invoice; a Credit Note refunded by Payment; a supplier Debit Note against a
Bill; a Receipt shared by two Invoices, one allocation reversed, then cancelled; a
cutover with open Invoices and an advance for one Party; a TPA settlement net of TDS
with a disallowance; a dealer receipt net of TDS and a bank charge; a school caution
deposit; an IPD deposit. None blocks building; each blocks CA acceptance.

ERPNext v15 and Zoho Books India reference check, 2026-09-24 (evidence in Git
history): both use the same document-first sequence and separate sales,
purchase, money, Journal, opening and settlement flows as the slices above.
Their reports, cutover import and party Journals match slices 6, 7 and 9, and
their TDS thresholds, deposit challans, card clearing and bank reconciliation
match the Deferred gates. The check validates workflow shape only, not pilot
speed, TDS correctness or a real cutover; the worked examples above remain the
test.
