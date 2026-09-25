# Spec: Accounting core

Status: slices 1–3, 4a, 4b-i, 4b-ii, 5 (Journal, Opening Balance, locks)
and 8 (chart of accounts) are implemented. Slices 6–7 and 9 (party Journals)
are open; remaining runtime and CA acceptance work is in the work registry.
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
  numbered (`FINANCIAL_YEAR_FIXED`).
- **Party**: role flags (descriptive only), optional `gstin` and `pan`, and an
  address `stateCode`. `party.update` replaces all fields, with the loaded
  `updatedAt` as its token. With a GSTIN, the server derives `stateCode` and
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
  `active` flag. `taxCode` is required exactly when the income Account is
  `taxable`.
- **Tax Rate**: `code`, `name`, an integer `rateBasisPoints` from 0 to 10,000,
  `effectiveFrom` and an inclusive `effectiveTo`. Rows are never edited, and
  `(Organization, code, effectiveFrom)` is unique. `seedTaxRates` gives each
  Organization GST5, GST12 and GST18 from 2017-07-01, GST28 until 2026-01-31,
  and GST40 from 2025-09-22. There is no GST0: the income Account's supply
  class decides nil and exempt supplies.
- **Money account** and **Payment Method**: see
  [Architecture](../architecture.md#money-accounts).
- **Document** header: `number`, `series`, `financialYear`, `documentDate`,
  `dueDate`, `placeOfSupplyStateCode`, `partyId`, `exposureSide`,
  `settlementKind`, `advanceSupply`, `paymentMethodId`, `reference`, `source`,
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
  side it touches.
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
   A cancellation is checked on its reversal date. Ordinary documents reverse
   on today's business date in the Organization's time zone. **Opening Balance
   reverses on its original cutover date**, so cancellation and replacement
   correct historical balances. A locked cutover needs an authorized exception
   or reopening; keeping the period closed instead calls for a current-period
   Journal adjustment without cancelling the opening. Ledger rows remain
   append-only and `cancelledAt` records the actual cancellation instant
   ([approved policy and references](../research/opening-balance-correction-policy-2026-09-22.md)).
8. **External posting is post-MVP.** References, digests, deduplication,
   ingestion and API keys arrive together.
9. **Reports.** Accounting reports read journal lines. P&L and balance sheet
   come from Statement Definitions. Each report states its range, and
   `unclosed` until period close exists.
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
    Sources hold a credit: `advance` and `against` Receipts, and from slice 9a
    a Journal with a `receivables` credit. Targets hold a debit: Invoices, and
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
    lists filter open or overdue settlement.

## Slices

Each open slice lists the deleted outpatient billing code that solved a similar
problem. Git keeps it at `a716b6c`. Read it; do not copy it.

1. **Spine, Party, templates, money.** Implemented: the settings row, chart
   templates, Parties with a namesake check and one GSTIN per Organization (an
   application check, `PARTY_GSTIN_TAKEN`), master lists complete to 5,000
   rows then `MASTER_LIST_LIMIT`, money accounts and methods.
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
   Account is not `notASupply`. Any line with a Tax Rate prints Tax Invoice;
   otherwise it prints Bill of Supply. `invoice.get` and `bill.get` return
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
     code is `TAX_CODE_INVALID`. `amount` is the taxable value.
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
   - **Header discount** (Invoice). Optional `discount` splits pro rata over
     each line's pre-discount value, half-up. Correct rounding on the first
     largest line, then other lines in input order if needed, so every line's
     discount stays between zero and its pre-discount value. A line stores its `discountPaise`, and
     `amountPaise` stays the taxable value after discount. A discount above
     the subtotal is `DISCOUNT_EXCEEDS_SUBTOTAL`; a zero total stays
     `INVOICE_ZERO_TOTAL`.
   - **Counter sale.** `invoice.post` takes optional
     `settle: { paymentMethodId, reference? }` and, in the same transaction, posts an
     `against` Receipt for the Invoice total allocated to it. The Invoice
     numbers before the Receipt. Needs `invoice:post` and `receipt:post`.
   - **Cancel and copy.** `invoice.amend` and `bill.amend` take
     `{ id, reason }`, cancel under the normal rules and return a new draft
     copying the header and lines with `amendedFromId`. Need `cancel` and
     `create` on the type. Audited.
     An Invoice or Bill with any posted note against it refuses both cancel
     and amend (`CONFLICT`, naming the notes).
   - **Pickers.** `party.openItems({ partyId, side })` returns targets with
     outstanding (`{ id, type, number, documentDate, dueDate, outstandingPaise }`)
     and `party.openCredits({ partyId, side, type? })` returns sources with unapplied
     credit (`{ id, type, number, documentDate, unappliedPaise }`); both the
     200 oldest and `hasMore`. The optional credit `type` filters before the limit;
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
     title is "Invoice" until the CA approves print classes (Product).
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
   - Web: Accounting > Chart of accounts lists code, name, type, parent ledger,
     supply class and status. New account picks its parent from a
     `NativeSelect` grouped by type (a type's top level or an existing group),
     then Name, and GST supply class for income. For editors, each row opens its
     Rename Sheet (`?edit=`); Mark inactive / Mark active is a button in that
     Sheet for posting leaves, and the status reads Active or Inactive, as for
     Parties and Items. Read-only rows have no edit link. Banking's Add account
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
9. **Party Journals.** Open, in two parts, after slice 8. A Journal line on a
   party control account carries a required Party and writes the party ledger,
   so the sum of party statements equals the control account by construction.
   ERPNext's `Party Type` and `Party` on a Journal Entry row and Tally's party
   ledger do the same. The Journal stays the escape hatch; the common cases
   keep their document (Invoice header discount and Credit Note in 4b-ii,
   Receipt `against`), and the form says so.

   **9a. Receivables lines and Journal credits.**
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
     the net is `BAD_REQUEST`). Posting writes the allocation rows with the
     Journal as source and no journal entry. The unallocated rest is an
     unapplied credit on `receivables`: not an advance, no `advanceSupply`, no
     `customerAdvances`.
   - `allocation.apply` takes `sourceDocumentId`, `targetDocumentId` and
     `amount`; `applyAllocations` reads a Journal's capacity as its net
     `receivables` credit for the target's party (call 17), the same quantity
     posting capped against, and admits a posted Journal with such a credit.
     Applying or reversing from a Journal writes no entry.
     `party.openCredits({ partyId, side: "receivable" })` already lists
     receivable credits; 9a adds Journals with unapplied credit for the party
     alongside Receipts, with the same 200-oldest limit and `hasMore`.
   - Cancel: `reverseDocument` already reverses party ledger lines; a Journal
     cancel appends reverse rows for its active allocations with no entry, as
     Receipt cancel does.
   - Web: the Journal line's Party field turns required when the account is a
     control account, with the hint "Changes what this party owes"; a
     `receivables` credit line shows the Receipt form's open invoices grid.
     Journal detail lists party lines and allocations with Reverse, as Invoice
     detail does. The party Ledger links a Journal line to its record as it
     links Receipts. Apply credit already lists `party.openCredits`; 9a adds
     Journal credits to that sheet.
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
     `apply-credit-sheet.tsx`,
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

   **9b. Journal debits as open items.** A Journal netting to a `receivables`
   debit for a party (the Rahul side of a transfer, a charge with no Invoice)
   is settleable: Receipt `against` and `allocation.apply` may target it.
   `party.openItems({ partyId, side: "receivable" })` already lists Invoices;
   9b adds Journal debits with outstanding, 200 oldest and `hasMore`, with
   `dueDate` null for a Journal. Invoice list open and overdue filters stay
   Invoice-only. A Journal with active allocations targeting it refuses cancel
   (`CONFLICT`, naming the sources), as an Invoice does. The Receipt form's
   grid is titled Open items and shows type and number.
   - Acceptance: after the sibling transfer, a Receipt `against` Rahul settles
     the 2,000 Journal debit; Rahul's balance and `receivables` both fall by
     2,000; the Journal refuses cancel until that allocation is reversed.
   - Verify: as 9a. Depends on: 9a. Owns:
     `packages/api/src/core/allocations.ts` (target rule),
     `packages/api/src/routers/party.ts`, `invoice.ts`, `receipt.ts`,
     `apps/web/src/components/receipt-form.tsx`. Interfaces: `party.openItems`
     rows are
     `{ id, type: "invoice" | "journal", number, documentDate, dueDate, outstandingPaise }`.

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
  input, output and cess accounts, and `taxable` income when the Organization
  has a `gstin` (the call 16 guard). The party control accounts
  (`receivables`, `payables`, `customerAdvances`, `supplierAdvances`) are
  refused; slice 9a admits `receivables` with a required Party and keeps the
  other three refused. Opening Balance
  keeps refusing them. Thus `affectsTax` is false, and before slice 9 the
  Journal writes no party ledger lines. The batch predicate `journalAccounts`
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
  (`OB26-27/1`), `documentDate` is the cutover, narration `Opening balances`,
  lines as the Journal minus party; the control accounts stay refused. A complete balanced
  trial balance needs no `openingEquity` line; any opening-equity amount is an
  explicit line the user enters, never a silent plug.
  `affectsTax` false, no party ledger lines. Cancellation via `reverseDocument`
  posts an opposite entry on the original cutover and checks that date's lock;
  refusal rolls back the cancellation. The original and reversal remain
  auditable. A replacement can use the same cutover, subject to normal posting
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
  `{ userId, expiresAt, reason, grantedBy, revokedAt/revokedBy/revokeReason }`;
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
  `CONFLICT`); all three mutations audited. Web: Settings > Opening balance
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
| GST accounts and line tax              | The monthly GST-on-fee reclass gate                               |
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
- **Lock history view.** The rows exist; a list arrives when a CA asks.
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
   13 TDS rows; the GST seed dates (GST28 ends 2026-01-31 and GST40 starts
   2025-09-22, both from secondary sources; GST12 has no end date, so confirm
   whether any supply still takes 12% after the 2025-09-22 rationalization); half-up rupee TDS versus exact
   paise; the chart templates (the trust "Fees" account is `taxable`, the
   professional "Rent Received" is `exempt`); and these worked examples, tax
   excluded: a ₹10,000 advance with ₹4,000 applied to a ₹6,000 Invoice; a
   Credit Note refunded by Payment; a supplier Debit Note against a Bill; a
   Receipt shared by two Invoices, one allocation reversed, then cancelled; a
   cutover with open Invoices and an advance for one Party; a TPA settlement
   net of TDS with a disallowance; a dealer receipt net of TDS and a bank
   charge; a school caution deposit; an IPD deposit.
