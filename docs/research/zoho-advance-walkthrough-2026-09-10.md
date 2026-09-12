# Zoho Books: answers to the remaining spec question

Research date: 2026-09-10. Scope: both files in `docs/specs`.

## Question

Accounting core has one open question: separate advance accounts or one control
per side. It names five worked cases. Client patterns has no independent open
question. Deferred features and unrun acceptance tests are not answered by a
competitor demo.

## Answer

Recommend separate customer-advance liability and supplier-advance asset
accounts, with transfer entries when advances are applied. This replaces the
earlier research recommendation to offer one control per side to the CA. It
does not record CA approval or change the provisional implementation contract.
The remaining decision is whether the CA accepts this recommendation for Accly.

Zoho's demo lists Unearned Revenue as Other Current Liability and Prepaid
Expenses as Other Current Asset, alongside Accounts Receivable and Accounts
Payable. Its official payment explanation explicitly describes an advance
intermediary and application entries. This is more than separate report labels.
Sources: [demo chart](https://www.zoho.com/us/books/accounting-software-demo/#/accountant/chartofaccounts),
[payment accounting](https://www.zoho.com/uk/books/kb/accountant/acc-vendor-payments.html).

## Evidence from the browser

I opened the supplied US demo in Chrome, followed Sales and Purchases, and
inspected these screens. No transaction was saved, sent, approved or deleted.

| Screen                                                                                                   | Observed behavior                                                                                                                                       | Evidence limit                                                                                                                              |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [Payments Received](https://www.zoho.com/us/books/accounting-software-demo/#/paymentsreceived)           | Separate Amount and Unused Amount columns; invoice and retainer payment types.                                                                          | Sample rows do not prove accounting rules.                                                                                                  |
| [Record customer payment](https://www.zoho.com/us/books/accounting-software-demo/#/paymentsreceived/new) | Customer, amount, bank charges, date, mode, deposit account and reference; unpaid invoice allocation table; received, used, refunded and excess totals. | Form inspection only; no advance application executed.                                                                                      |
| [Payment detail](https://www.zoho.com/us/books/accounting-software-demo/#/paymentsreceived/616494)       | Linked invoice, payment amount, PDF/Print and Journal control.                                                                                          | The selected payment showed $10 while its explicitly labelled sample PDF showed ₹400 for another customer. Journal exposed no usable lines. |
| [Credit note detail](https://www.zoho.com/us/books/accounting-software-demo/#/creditnotes/39560)         | Approval actions and a sample credit note PDF.                                                                                                          | Record was awaiting approval; journal unavailable. No refund was executed.                                                                  |
| [Record vendor payment](https://www.zoho.com/us/books/accounting-software-demo/#/paymentsmade/new)       | Vendor, paid-through account, bill allocation table and paid, used, refunded and excess totals.                                                         | No vendor advance was posted. Leaving the blank form showed a discard prompt.                                                               |
| [Chart of accounts](https://www.zoho.com/us/books/accounting-software-demo/#/accountant/chartofaccounts) | Separate receivable, payable, Unearned Revenue and Prepaid Expenses accounts.                                                                           | Account presence alone does not prove posting behavior; official documentation supplies that evidence.                                      |

The demo states that actions are limited. Its mixed US currency and Indian
sample PDFs cannot validate either jurisdiction's tax treatment. Sample record
IDs may change. The module routes and visible labels are the reproducible path.

## Five worked answers

These are proposed Accly acceptance examples, derived from the separate-account
model. They were not executed in Zoho. Amounts are illustrative rupees, with tax
excluded to isolate principal. Dr means debit; Cr means credit.

### 1. Customer advance, then partial application

Receive ₹10,000: Dr Bank ₹10,000; Cr Customer Advances ₹10,000.
Post an Invoice for ₹6,000: Dr Receivables ₹6,000; Cr Income ₹6,000.
Apply ₹4,000: Dr Customer Advances ₹4,000; Cr Receivables ₹4,000.
The Invoice has ₹2,000 outstanding; the advance has ₹6,000 unused. Application
does not touch Bank. Supplier application mirrors this: Dr Payables and Cr
Supplier Advances for the applied amount.

Zoho documents customer application separately from receipt and permits an
amount for each invoice. Its accounting FAQ supplies the intermediary transfer
pattern. [Customer advance workflow](https://www.zoho.com/in/books/help/payments-received/functions.html),
[payment accounting](https://www.zoho.com/uk/books/kb/accountant/acc-vendor-payments.html).

### 2. Customer Credit Note refunded by Payment

For a fully paid sale, issue an unapplied ₹2,000 Credit Note: Dr Sales Returns
₹2,000; Cr Receivables ₹2,000. Refund it: Dr Receivables ₹2,000; Cr Bank ₹2,000.
Both the note's available credit and the refund's unmatched amount end at zero.
This is a customer-side Payment, not a vendor expense. A refund of an unused
advance instead debits Customer Advances; the source credit determines the
account. Do not treat every customer credit as an advance.

Zoho supports full and partial Credit Note refunds. Its help proves the user
operation, not these exact inferred journal lines.
[Refund credits](https://www.zoho.com/us/books/help/credit-note/refund-credits.html).

### 3. Supplier Debit Note against a Bill

Post a ₹10,000 Bill: Dr Expense ₹10,000; Cr Payables ₹10,000. Record a ₹2,000
supplier-side reduction: Dr Payables ₹2,000; Cr the original Expense ₹2,000.
Apply that note to the Bill. Outstanding becomes ₹8,000. No Bank entry and no
advance transfer are needed: both items already use Payables.

Zoho calls its supplier credit document a Vendor Credit and allows application
to one or more bills for the same vendor. That is the settlement analogue of
Accly's supplier Debit Note; the legal document names are not interchangeable.
[Vendor credits](https://www.zoho.com/us/books/help/vendor-credits/functions.html).

### 4. Shared Receipt, one unapplication, then cancellation

Start with two open Invoices, A ₹6,000 and B ₹4,000. Receive ₹10,000 into the
advance intermediary: Dr Bank; Cr Customer Advances. Apply ₹6,000 to A and
₹4,000 to B: each application debits Customer Advances and credits Receivables.
Unapply A: Dr Receivables ₹6,000; Cr Customer Advances ₹6,000. A reopens, B stays
settled, cash stays ₹10,000 and unused advance becomes ₹6,000.

Cancel the Receipt under Accly's reversal policy: reverse B's still-active
application (Dr Receivables ₹4,000; Cr Customer Advances ₹4,000), then reverse
the Receipt (Dr Customer Advances ₹10,000; Cr Bank ₹10,000). A must not be
unapplied twice. Both Invoices are open, Bank has zero net movement and the
advance balance is zero. This corrects a receipt recorded in error; an actual
later cash refund is a separate transaction.

Zoho documents multi-invoice intermediary entries and removing an individual
application. The atomic, append-only cancellation above is an Accly proposal,
not an observed Zoho guarantee. [Payment accounting](https://www.zoho.com/uk/books/kb/accountant/acc-vendor-payments.html),
[application changes](https://www.zoho.com/in/books/help/payments-received/functions.html).

### 5. Cutover with open Invoices and an advance for one Party

Import ₹12,000 in open Invoices and ₹5,000 in unused customer advances
separately. Their contribution to the opening entry is Dr Receivables ₹12,000;
Cr Customer Advances ₹5,000; Cr Opening Equity ₹7,000. Opening documents carry
the corresponding open items without posting those amounts again. Do not
replace the two balances with one ₹7,000 receivable. Reconcile each Party by
control account and open-item category, then reconcile the net statement.
Supplier advances similarly belong in their asset account at cutover.

Zoho's India opening-balance instructions use Unearned Revenue for customer
advances and Prepaid Expenses for vendor advances, then synchronize the
individual payments. Accly can retain its atomic import rather than copy that
manual workflow. [Opening advances](https://www.zoho.com/in/books/kb/opening-balance/excess-payment.html).

## What this means for the specs

If the CA accepts separate accounts, change accounting-core calls 14–17 and
slices 2–5 and 7 together before coding. Add advance account mappings; let
`recordEntry` accept allocation application and reversal events; link those
entries to their source events; reverse stored lines; update balances and
locks in the same transaction. Remove blanket promises that allocations never
post entries. Note-to-invoice and note-to-bill allocations can remain entry-free
when the documents already share the control account. Update opening import
reconciliation to preserve gross controls and advances.

Client slice 4 keeps its apply/unapply flow but must not promise that every
allocation is entry-free. It must continue to show source credit, applied amount
and outstanding. Client speed, keyboard behavior and lost-response recovery
remain Accly acceptance tests; this demo supplies no pass evidence.

Tax timing is a separate decision. Zoho India has taxable-advance fields, which
shows that this is a distinct workflow. It does not establish Accly's tax
obligation. Retain the existing taxable-advance refusal and CA gate.
[Advance fields](https://www.zoho.com/in/books/help/payments-received/functions.html).

## Next verification

The CA must accept the five examples or identify a required alternative, with
name and date in accounting-core. This is the existing spec's approval gate,
not a new research requirement. Then revise the dependent contracts as one
change and run their acceptance tests. The reference question is answered;
CA acceptance and implementation verification remain unproved.
