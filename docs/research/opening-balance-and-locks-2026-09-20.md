# Opening Balance and period locks: how other systems do it

## Question

Slice 5 owes an Opening Balance document and general plus tax locks with
expiring user exceptions. How do ERPNext, Frappe Books, Zoho Books, QuickBooks
Online, Xero and TallyPrime solve the same two problems, and which of our
spec decisions do they support or contradict?

## Answer

Four of our six spec decisions are confirmed by practice, one is contradicted by
our own code, and one is genuinely novel.

1. **One Opening Balance per Organization: keep it.** Zoho and Xero both fix a
   single org-level cutover date and one balance set. ERPNext allows unlimited
   opening Journal Entries and has to warn users in prose not to make a new one
   each year. Our partial unique index is the stricter, better-founded choice.
2. **`openingEquity` as the balancing account: confirmed, unanimous.** Every
   system seeds a plug account under a different name.
3. **`controls: false`, party balances only from slice 7 opening items:
   confirmed, and it is the best of the three models in use.** Zoho enforces the
   same mutual exclusion. Xero enforces equality instead. ERPNext and QBO allow
   both paths and rely on operator discipline. Frappe Books shows the failure
   mode: its journal lines carry no party at all, so an opening receivable never
   reaches party outstanding.
4. **A separate tax lock: confirmed, unanimous.** All four commercial products
   lock the tax filing period independently of the books close.
5. **"Cancellation checks both dates" contradicts our own reversal code.** We
   date reversals today, and ERPNext's matching immutable-ledger mode validates
   only that reversal date, not the original. Decide this before building.
6. **Expiring user exceptions are novel. Nobody does it.** Bypass is a role, a
   shared password, or a non-expiring named exemption list. Keep the expiry as a
   deliberate differentiator, with the knowledge that it is unproven.

## Evidence

### Opening Balance mechanism and the plug account

| System            | Shape                                                                        | Plug account                                                             |
| ----------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| ERPNext           | Journal Entry, `voucher_type = "Opening Entry"`, forces `is_opening = "Yes"` | **Temporary Opening** (asset, type `Temporary`), expected to net to zero |
| Frappe Books      | Manual Journal Entry, `entryType = "Opening Entry"`                          | **Opening Balance Equity**, seeded but never referenced by code          |
| Zoho Books        | Dedicated Settings screen, one org-level Opening Balance Date                | **Opening Balance Adjustments**, posted automatically                    |
| QuickBooks Online | Per-account balance plus an "As of" date; no single company date             | **Opening Balance Equity**, automatic                                    |
| Xero              | Conversion Balances screen, one conversion date, always the 1st of a month   | **Historical Adjustment**, auto-filled, clears when the entry balances   |
| TallyPrime        | Per-ledger `Opening Balance` field; company `Books beginning from`           | **Difference in Opening Balances**                                       |

- ERPNext: `is_opening` forced in `journal_entry.py:121-123`; opening rows may
  not touch a P&L account, `gl_entry.py:212-222`; Temporary Opening resolved by
  `account_type == "Temporary"`,
  `opening_invoice_creation_tool.py:323-332`. There is **no** Opening Balance
  Equity account in core ERPNext. Read at `version-15`, v15.121.3.
- Frappe Books: `Opening Balance Equity` at `src/setup/standardCOA.ts:166`, but
  absent from the India and Singapore charts (`fixtures/verified/in.json`,
  `sg.json`). `entryType` is inert: `getPosting()` never branches on it. Read at
  commit `8f09465`, v0.37.0.
- Zoho: "if there is a difference found between the values, a corresponding
  entry will be posted to the Opening Balance Adjustments account automatically".
- Xero: "When debit and credit totals in a transaction don't match, Xero enters
  the difference in the historical adjustment account", and it disappears once
  the entry balances. Xero's is the only plug of the six that cannot silently
  survive into the live books; Zoho's and QBO's are cleared by hand, and Tally's
  is a computed display.

Nobody auto-reverses the plug. Zoho's Opening Balance Adjustments also absorbs
transactions dated on or before the migration date, and is cleared either by
re-dating those transactions or by a manual journal.

**The plug divides the field into two philosophies, and we already picked the
better one.** Zoho and QBO let you save an unbalanced opening position and park
the error in a real account you must clear by hand. Xero refuses the save until
debits equal credits. Our Journal already rejects an unbalanced entry
(`postInput.superRefine`, `packages/api/src/routers/journal.ts:46-64`), and the
Opening Balance reuses that path, so we land on Xero's side for free:
`openingEquity` is a deliberate balancing line the user enters, never a silent
plug the system posts behind them.

### One document, or many

- **ERPNext: many, unconstrained.** No uniqueness check of any kind on
  `voucher_type = "Opening Entry"`. The only limit is temporal: once a Period
  Closing Voucher is submitted, no further opening entry can be created,
  `general_ledger.py:807-818`. The docs then ask the user, in prose, to "not
  create a new opening entry every year".
- **Zoho: one, and hard to move.** Changing the org opening balance date with
  more than 50 contacts requires zeroing every contact's opening balance first.
- **Xero: one conversion date**, always the first of a month.
- **QBO: none.** Each account carries its own "As of" date; "There is no single
  fixed company date". This is the documented root cause of the lingering
  Opening Balance Equity balance QBO users complain about.

### Party opening balances and the control-account double count

Three distinct models, all first-party:

- **Mutual exclusion (Zoho).** Either the AR/AP account-level figure or the
  contact-level balances, never both: "If you ... have already entered the
  opening balance for Accounts Payable, you will not be able to import the
  vendor balances" without resetting AP to zero.
- **Enforced equality (Xero).** You enter the control balance _and_ the
  individual invoices, bills and credit notes. "If the totals of the
  transactions and the accounts receivable and accounts payable balances don't
  exactly match, Xero won't save your conversion balances."
- **Individual open documents (QBO).** Intuit tells users to leave the contact
  opening balance blank and enter each unpaid invoice and bill instead, so the
  AR/AP control balance is the sum of real documents and no rival figure exists.
  Ageing and allocation survive the cutover.
- **Operator discipline (ERPNext).** ERPNext ships the Opening Invoice
  Creation Tool, which posts real invoices flagged `is_opening = "Yes"` with the
  line account set to Temporary Opening
  (`opening_invoice_creation_tool.py:177-236`; expected GL confirmed in
  `test_sales_invoice.py:4539`). An opening Journal Entry may _also_ hit
  receivables, with party then mandatory (`journal_entry.py:494-502`). Nothing
  reconciles the two paths. The only signal is Temporary Opening failing to net
  to zero.
- **Structural (Tally).** The ledger's opening balance decomposes into a
  Bill-wise Breakup, with the remainder shown as `On Account`. One number, two
  views, so no double count is possible.
- **Broken (Frappe Books).** `JournalEntryAccount` has exactly three fields:
  `account`, `debit`, `credit`. No party. `Party.outstandingAmount` is computed
  only from submitted invoices and never consults ledger entries
  (`models/baseModels/Party/Party.ts:26-56`). An opening journal line against
  Debtors therefore produces a ledger balance attached to no one, invisible to
  party outstanding and to payment allocation.

### General books lock

| System       | Mechanism                                                                                          | Bypass                                                                                          | Reason required                                     |
| ------------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| ERPNext      | `acc_frozen_upto` (`<=`, inclusive); plus Accounting Period ranges; plus Period Closing Voucher    | one global Role; Administrator explicitly blocked; Accounting Period and PCV have **no** bypass | no                                                  |
| Frappe Books | **none at all**                                                                                    | n/a                                                                                             | n/a                                                 |
| Zoho Books   | Four independent module lock dates: Sales, Purchases, Banking, Accounts                            | per-user and per-account exemption lists (API only)                                             | **yes, on lock and on unlock**                      |
| QBO          | one global closing date                                                                            | warning only, or warning plus shared password; admins bypass without it                         | no, but an Exceptions to Closing Date report exists |
| Xero         | two tiers: stop all users, or stop non-advisers only                                               | the Adviser/Administrator role                                                                  | no                                                  |
| TallyPrime   | `Cut-off date for Back Dated vouchers` plus a rolling `Days allowed` window, on the Security Level | security level only                                                                             | no                                                  |

Detail worth carrying:

- **Inclusive comparison is standard.** ERPNext throws when
  `getdate(posting_date) <= getdate(acc_frozen_upto)`,
  `general_ledger.py:783-804`. Zoho documents the same off-by-one as a user
  warning: "If you do not want transactions to be created on the date specified
  as the lock date, set the next date from the intended date as the lock date."
  Our spec's "on or before the general lock" matches.
- **ERPNext explicitly blocks Administrator**, with the reason in the docstring:
  "Administrator has all the roles so this check will be bypassed if any role is
  allowed to post. Hence stop admin to bypass." The bypass must be an explicit
  grant, never a side effect of holding every permission.
- **Frappe Books has no lock of any kind.** Confirmed by grep across the whole
  tree for freeze, frozen, period clos, closing date, lockDate, book clos,
  backdat: the only hits are `Object.freeze` and `fiscalYearStart`/`End`, which
  are consumed solely by `reports/AccountReport.ts:454-458`. Worse, a submitted
  document from any past year can be cancelled and then hard-deleted, and
  `Transactional.afterDelete()` deletes its ledger rows outright.
- **Zoho's partial unlock** opens a bounded _transaction date range_ with a
  mandatory reason, and is refused entirely for organizations with
  inventory-tracked items.

### Cancelling a document inside a locked period

This is the one place the sources answer a question our spec gets wrong.

ERPNext checks the freeze on cancellation from `make_reverse_gl_entries`
(`general_ledger.py:708`). Which date it checks depends on a setting:

- Default: the **original posting date** is validated, so an old document cannot
  be cancelled once its period is frozen.
- With `Accounts Settings.enable_immutable_ledger` on: the reversal is **dated
  today** and today is what gets validated (`general_ledger.py:678, 704-708`).

We already behave like the second mode. `reverseDocument` computes
`entryDate = businessDate(cancelledAt, timeZone)`
(`packages/api/src/core/documents.ts:403`), so a cancellation never alters the
original period's journal lines. Under that design, validating the original
document date as well would block cancelling any old document forever while
protecting nothing extra, because the locked period's trial balance cannot move.

Neither ERPNext mode checks both dates. No other system checks two dates either.

### Tax-period lock

Unanimous, and separate from the books close in all four commercial products:

- **Zoho Books (India GST)**: filing status is the lock. Once a GSTR is filed or
  marked filed, its transactions cannot be edited; you unfile **GSTR-1** for
  sales or reopen **GSTR-2** for purchases, in reverse chronological order. The
  lock is split by direction.
- **QBO**: a filed sales tax return cannot be edited. That much is first-party;
  the claim that un-filing is a QuickBooks Online Accountant privilege rests on
  an Intuit community thread **(community)**, not a help article.
- **Xero**: a finalised VAT return cannot be amended in place **(community)** —
  forum threads only, for the rendering reason below.
- **TallyPrime**: uniquely a _soft_ lock, with a design idea none of the others
  have. A voucher dated into a signed return period still saves; it is excluded
  from the return and surfaces under Uncertain Transactions. `Alt+F10` undoes
  the filing, or `Alt+L` **sets an effective date: the voucher keeps its book
  date and moves to a later return**. That separates the accounting date from
  the tax period instead of forcing a choice between them.
- **ERPNext: none.** Confirmed absent, not assumed: zero hits for `tax_period`,
  `filing_period`, `return_period` anywhere in the package. India GST left core
  in v14 (`patches/v14_0/remove_india_localisation.py`) for the third-party
  `india_compliance` app.

### Exceptions

**No system issues a grant that lapses on a date.** The full inventory:

- **Zoho**, API only: `user_ids[]`, "List of user IDs to exempt from the lock",
  and `account_ids[]` for accounts, on `PUT /transactionlock`, with
  `reason` (max 500 chars), `locked_by`, `user_exceptions_count`, and a
  `transaction_lock_status` of `disabled | enabled | enabled_with_logging`. No
  expiry field. None of these exemptions appear in any Zoho help page.
- **QBO**: a shared password, which gates non-admins only, since an admin can
  reset it without knowing the old one.
- **Xero, Tally, ERPNext**: a role.
- Closest near-misses: Zoho's partial unlock bounds which _transaction dates_
  become editable, not how long the grant lives, and someone must re-lock by
  hand. Tally's `Days allowed for Back Dated vouchers` slides forward as
  vouchers are entered, so it lapses relative to data entry, and it is a
  standing security-level setting rather than a grant to a person.

## What this proves, and what it does not

**Proves.** The plug-account pattern, the inclusive `<=` lock comparison, the
separate tax-period lock, and the need for an explicit bypass grant rather than
an implicit "has all permissions" one. It also proves three viable designs for
the receivables double count, with a worked failure case for the fourth.

**Does not prove.** Nothing here is evidence of what Indian CAs actually do at
cutover, how often they need a back-dated exception, or whether an expiring
exception would be used or merely tolerated. Feature documentation is not
workflow evidence. The Zoho per-user exemption list is documented only in the
API reference, so we cannot tell whether it is shipped UI, edition-gated, or
vestigial.

**Weak spots in the evidence.** Xero's lock-date quotes come from Xero's own
indexed article text via search rather than pages we rendered, because Xero
Central renders client-side and returned empty to every direct fetch; its
VAT-return lock is evidenced only by forum threads. QBO's tax un-file rule is
likewise community-sourced. The Zoho role required to lock or unlock is stated
on no page. ERPNext's user-facing Period Closing Voucher page claims it "does
not prevent backdated entries", which the v15 source contradicts at the GL
layer, so treat their prose as weaker than their code.

## What this means for us

Confirmed, build as specified:

- One Opening Balance per Organization, partial unique index on posted
  `openingBalance`, fixed `OB` prefix, explicitly balanced. Use `openingEquity`
  (seeded at code 3000) when needed; a complete balanced trial balance needs no
  additional equity line.
  `documents.type` and `documents.source` already carry `openingBalance` and
  `opening` (`packages/db/src/schema/documents.ts:31,38`).
- `controls: false` on the Opening Balance, party balances only from slice 7
  opening items. This is Zoho's mutual-exclusion model and needs no
  reconciliation code.
- Current lock dates on settings, with lock history and exceptions behind their
  own procedures, not `settings.update`.
- General lock inclusive of the lock date, and a tax lock keyed to the stored
  `affectsTax`.

Decided (2026-09-20):

- **A cancellation is checked on its reversal date only**, matching ERPNext's
  `enable_immutable_ledger` mode. The spec line "Cancellation checks both dates"
  is amended accordingly. Accepted consequence: a closed period's _numbers_ are
  frozen, but a document inside it can still change state.

Adopt from the field (both now written into the spec):

- **A mandatory reason on lock and unlock**, stored on the lock row, not only in
  the audit trail. Only Zoho requires this and it is the single cheapest
  integrity feature among the six.
- **Block the org owner from implicit bypass.** Take ERPNext's lesson directly:
  an exception is a row naming a user, never a consequence of holding every
  grant.

Keep, knowing it is unproven:

- **The expiring exception.** No competitor has one. It fits the integrity
  position and costs one timestamp column. Treat it as a bet to validate in CA
  interviews, not as a settled requirement.

Do not build:

- **Per-module locks.** Zoho's four modules and Xero's two tiers are more
  surface than our two locks need at this stage.
- **A direction-split tax lock** (Zoho's GSTR-1 versus GSTR-2). Revisit when the
  slice 4b-ii registers exist.
- **Tally's effective-date escape hatch**, where a document keeps its book date
  but reports into a later tax period. It is the most interesting idea in this
  research and it belongs with the registers in slice 4b-ii, not with the lock.
  Recorded here so it is not lost.

## Next falsification

Ask a CA, in the interview protocol, two questions that this desk research
cannot answer:

1. After you close a month, how often does a genuine back-dated correction
   arrive, and who should be allowed to post it?
2. If an exception to a closed period expired by itself after a set date, would
   that help you or get in your way?

If the answer to (2) is "get in my way", drop the expiry and ship Zoho's plain
per-user exemption list with a reason.

## Sources

**Source code, read directly**

- `frappe/erpnext`, branch `version-15`, tag v15.121.3, commit `26f0687`
  (2026-09-15): `accounts/general_ledger.py`,
  `accounts/doctype/journal_entry/journal_entry.py`,
  `accounts/doctype/gl_entry/gl_entry.py`,
  `accounts/doctype/opening_invoice_creation_tool/`,
  `accounts/doctype/accounts_settings/`,
  `accounts/doctype/accounting_period/`,
  `accounts/doctype/period_closing_voucher/`, `hooks.py`.
- `frappe/books`, branch `master`, commit `8f09465`, v0.37.0 (2026-09-20):
  `src/setup/standardCOA.ts`, `fixtures/verified/`, `schemas/app/JournalEntry.json`,
  `schemas/app/JournalEntryAccount.json`, `models/Transactional/`,
  `models/baseModels/Party/Party.ts`, `src/utils/getStartedConfig.ts`,
  `fyo/model/naming.ts`.

**First-party documentation**

- ERPNext: <https://docs.frappe.io/erpnext/opening-balance>,
  <https://docs.frappe.io/erpnext/period-closing-voucher>
- Frappe Books: <https://docs.frappe.io/books/setup-opening-balances>
- Zoho Books: <https://www.zoho.com/us/books/help/settings/opening-balances.html>,
  <https://www.zoho.com/us/books/kb/opening-balance/opening-bal-adj.html>,
  <https://www.zoho.com/us/books/help/contacts/opening-balances-for-customers.html>,
  <https://www.zoho.com/us/books/help/accountant/transaction-lock.html>,
  <https://www.zoho.com/us/books/kb/accountant/lock-date.html>,
  <https://www.zoho.com/books/api/v3/transaction-locking/>,
  <https://www.zoho.com/in/books/kb/gst/edit-transactions-included-in-a-filed-return.html>,
  <https://www.zoho.com/in/books/help/gst/filing-approval.html>
- QuickBooks Online: opening balance and close-books help articles at
  <https://quickbooks.intuit.com/learn-support/en-us/help-article/close-books/close-books-quickbooks-online/L59LelyPM_US_en_US>,
  <https://quickbooks.intuit.com/learn-support/en-us/help-article/customer-company-settings/edit-closed-books/L76xHuaZ5_US_en_US>
- Xero: <https://central.xero.com/0/article/Setting-your-conversion-date-US-GL>,
  <https://central.xero.com/0/article/Troubleshooting-for-conversion-balances>,
  <https://central.xero.com/s/article/Set-up-and-work-with-lock-dates-US>,
  <https://developer.xero.com/documentation/api/accounting/organisation>
- TallyPrime: <https://help.tallysolutions.com/tally-prime/access-control-data-security/data-security-faq/>,
  <https://help.tallysolutions.com/gstr-1-report-in-tallyprime/>,
  <https://help.tallysolutions.com/transaction-not-added-in-return-period/>
