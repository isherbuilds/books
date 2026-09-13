# Receipt settlement kinds for a school, a hospital and a manufacturer

Date: 2026-09-13. Status: findings; informs a decision, does not authorize a build.

Scope: call 16 of accounting-core (`docs/specs/accounting-core.md:74-82`), the slice 2
Receipt code, Zoho Books India help and API, ERPNext v16.34.2 (`4048fb70`, 2026-09-08),
Frappe Education (`22e0910d`), Frappe Health v16.5.2 (`934d6c16`), India Compliance
(`071b544a`), and CBIC and GST Council texts. It builds on the
[Zoho walkthrough](./zoho-advance-walkthrough-2026-09-10.md) and the
[contract decisions](./accounting-contract-decisions-2026-09-10.md). No product was used
to post a transaction. Zoho pages show no update date; all were read on 2026-09-13.

## Question

What exactly is a Receipt settlement kind? How do a school, a hospital and a
manufacturer settle money with it? Do Zoho Books and ERPNext do the same?

## Answer

1. `settlementKind` answers one question: what does this money settle? `against`
   settles a claim that exists now (an open Invoice or Debit Note). `advance` is
   money for a claim that does not exist yet. `direct` is money for which no
   claim will ever exist (bank interest, a donation). The user picks the kind;
   Accly infers nothing from the Party's open documents (`accounting-core.md:74`).
2. Each vertical uses all three (inference from the tax facts below). A school
   takes fees `against` fee Invoices and early fees as `advance`. A hospital
   takes IPD deposits as `advance` and insurer settlements `against` the bill. A
   manufacturer takes dealer payments `against` Invoices and order money as
   `advance`. All three take FD interest as `direct`.
3. Zoho Books India and ERPNext both record all three cases, but neither has one
   field for the choice (inference). Zoho uses separate screens: Payments Received,
   the Customer Advance tab, Retainer Invoices and Banking "Other Income"
   ([payments][z-basic], [advance][z-func], [other income][z-other]). ERPNext uses
   one Payment Entry for `against` and `advance`, and a Bank Entry or Cash Entry
   Journal Entry for `direct`, because a Receive Payment Entry throws "Party is
   mandatory" ([party check][e-party], [voucher types][e-je]).
4. The accounting shape matches both. Advance money sits in a liability and moves
   to receivables when applied, with no cash movement: Zoho's Unearned Revenue
   to Accounts Receivable ([Zoho KB][z-ur]), ERPNext's separate-account mode
   ([advance GL][e-advgl]), and Accly's decision of 2026-09-12 (`accounting-core.md:82`).
5. The top gap is that `against` is not built: `receipt.ts:108` refuses it until
   Invoices exist (slice 4). The second is that a Receipt has no deduction line
   for TDS the payer withheld, bank charges or a small write-off. Zoho and
   ERPNext both have one ([Zoho TDS][z-tds], [ERPNext deductions][e-ded]).
6. One spec text needs the owner's attention; it does not need a build now. Call 16
   says `allocation.apply` writes "no journal entry", which conflicts with the
   2026-09-12 transfer-entry decision in the same call (`accounting-core.md:82`).
   The per-receipt `advanceSupply` field now lets goods and exempt advances post
   without GST ([Notification 66/2017][g-66]); `taxableService` is refused with
   `ADVANCE_TAX_UNSUPPORTED` until GST advance documents exist.

## What a settlement kind is

Money received is one of three things. The kind fixes the credit side of the
entry and what the Party owes afterwards (`accounting-core.md:74-82`).

| Kind      | When                                          | Journal                                                                           | Party effect                                                                                                          |
| --------- | --------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `against` | An Invoice or Debit Note of the Party is open | Dr Payment Method account; Cr `receivables` with `partyId`                        | One Allocation per settled document; outstanding falls; a remainder becomes advance in the same entry. Not built.     |
| `advance` | Money arrives before any Invoice              | Dr Payment Method account; Cr `customerAdvances` with `partyId` (`posting.ts:79`) | One Party Ledger Line with negative exposure; `allocation.apply` later posts Dr `customerAdvances` / Cr `receivables` |
| `direct`  | No Invoice will ever exist                    | Dr Payment Method account; Cr an active `income` Account (`receipt.ts:151-165`)   | Party optional; no Party Ledger Line; refused in a GSTIN Organization for a `taxable` account (`receipt.ts:208`)      |

Four legal facts explain the rules. A taxable supply needs a tax invoice, so a taxable
`direct` Receipt is refused ([s.31(1)-(2)][g-s31]). An exempt supply needs a bill of
supply, waived below ₹200 ([s.31(3)(c)][g-s31]); Accly defers that document
(`accounting-core.md:162`). A goods advance carries no GST for a non-composition
supplier ([66/2017][g-66], narrowed by [50/2023][g-50]), but a service advance is taxed
on receipt ([s.13(2)][g-s13]). A deposit is not payment for a supply until the supplier
applies it ([s.2(31) proviso][g-s2]).

## School

Services by an educational institution to its students, faculty and staff are
Nil-rated ([12/2017-CT(Rate) entry 66][g-12]); its hostel services are exempt
([education flyer, p. 3][g-eduflyer]). Rows are inference from these facts.

| Case                                         | Accly kind                                  | What happens later                             | Gap                                                                                                          |
| -------------------------------------------- | ------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Term fee billed, paid in full or instalments | `against` the fee Invoice                   | Each Receipt lowers outstanding                | Waits for slice 4                                                                                            |
| Next-term fee paid before the term Invoice   | `advance`, student Party                    | `allocation.apply` when the term Invoice posts | Posts with `advanceSupply: exempt`; only `taxableService` is refused                                         |
| Late fee                                     | Invoice line or Debit Note, then `against`  | Same as a fee                                  | Late fee is in value ([s.15(2)(d)][g-s15]); exempt with the fee is inference ([Circular 178 para 9][g-c178]) |
| Refundable caution or admission deposit      | None fits                                   | Refund at exit, or forfeit                     | No deposit liability; `advance` would let it settle fees                                                     |
| General donation                             | `direct` to Donations (`notASupply`)        | Nothing                                        | Fits [Circular 116][g-c116]                                                                                  |
| Corpus donation to a fund account            | Refused: `direct` needs an `income` account | Nothing                                        | No `direct` to a fund or equity account (`receipt.ts:160`)                                                   |
| Scholarship or RTE money from government     | None fits: payer is not the student         | Would settle the student's Invoice             | No third-party payer (inference)                                                                             |
| FD interest                                  | `direct` to exempt Interest Income          | Nothing                                        | Fits [entry 27(a)][g-12]                                                                                     |

## Hospital

Health care by a clinical establishment is exempt ([entry 74(a)][g-12]). A non-ICU room
above ₹5,000 per day lost that exemption ([04/2022][g-0422]) and is taxed at 2.5% CGST
without ITC ([03/2022, entry 31A][g-0322]). Food for in-patients is part of exempt care
([Circular 32, item 5(3)][g-c32]).

| Case                                   | Accly kind                                                   | What happens later                           | Gap                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| OPD consultation paid at the counter   | `direct` to exempt income, or Invoice plus `against`         | Nothing                                      | No one-step bill and receipt; Zoho has Sales Receipt ([Zoho][z-sr]), Health uses `is_pos` ([Health][h-appt]) |
| IPD deposit at admission               | `advance`, patient Party                                     | Applied to the discharge Invoice             | Deposit or advance is unclear under s.2(31) (no CBIC clarification found)                                    |
| Discharge bill shortfall               | `against`                                                    | Invoice closes                               | Waits for slice 4                                                                                            |
| Refund of unused deposit               | No Receipt kind; a Payment debiting `customerAdvances`       | Advance closes                               | Spec defines only a refund against a Credit Note (`accounting-core.md:82`)                                   |
| Insurer or TPA settlement, net of TDS  | `against`, but the payer is not the patient                  | Claim closes; disallowed part is written off | No payer transfer, no TDS line, no write-off line                                                            |
| Corporate patients, many bills         | One `against` Receipt, many Allocations                      | Each bill closes                             | Needs the TDS line                                                                                           |
| Pharmacy counter sale                  | Invoice plus `against`; taxable `direct` is refused          | Nothing                                      | No one-step bill and receipt                                                                                 |
| Advance for a room above ₹5,000/day    | `advance`, but the service advance is taxable                | Tax at receipt ([s.13(2)][g-s13])            | `advanceSupply: taxableService` is refused until GST advance documents exist                                 |
| Rent from a canteen or pharmacy lessee | Invoice plus `against` (taxable, outside [entry 12][g-0422]) | Lessee deducts TDS                           | Template marks "Rent Received" exempt (`chart-templates.ts:149`; that it misleads is inference)              |

TPAs paying hospitals deduct TDS (CBDT Circular 8/2009, read from a [reproduction][s-c8];
the owner page returned 403). The 2025 Act cites section 393 from April 2026
([Income Tax FAQ][it-faq]); the 194J mapping rests on a [secondary source][s-393]. Frappe
Health moves the covered amount from the patient to the payor receivable ([Health][h-ins]).

## Manufacturer

Goods are taxable. A registered non-composition goods supplier pays no GST on an
advance ([66/2017][g-66], [GST Council flyer ch. 6][g-flyer6]). Rows are inference.

| Case                                           | Accly kind                                    | What happens later                 | Gap                                                                                                   |
| ---------------------------------------------- | --------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Dealer pays one or many Invoices, full or part | `against`; remainder becomes advance          | Each Invoice lowers outstanding    | Waits for slice 4                                                                                     |
| Dealer deducts TDS                             | `against` plus a TDS debit                    | TDS claimed in the return          | `tdsReceivable` is seeded (`chart-templates.ts:60-63`) but no code posts to it                        |
| Cash discount, short payment, bank charges     | `against` plus a deduction                    | Invoice closes                     | No deduction line; a discount after supply stays in value without a credit note ([s.15(3)(b)][g-s15]) |
| Order advance for goods                        | `advance`                                     | Applied at the Invoice             | Posts with `advanceSupply: goods`; no GST is due                                                      |
| Advance for installation or AMC service        | `advance` with GST                            | Tax at receipt, reversed at supply | `advanceSupply: taxableService` is refused until GST advance documents exist                          |
| Scrap sale                                     | Invoice plus `against` (taxable goods)        | Nothing                            | No TCS line (secondary source only: [s.394][s-394])                                                   |
| Delayed-payment interest from a dealer         | Debit Note plus `against`                     | Nothing                            | It is value of the goods supply ([s.15(2)(d)][g-s15]), not exempt FD interest                         |
| Insurance claim on lost stock                  | `direct` to a `notASupply` account on receipt | Nothing                            | An accrued claim receivable cannot be settled by `direct` (`receipt.ts:160`)                          |
| Export receipt                                 | `against`                                     | Nothing                            | Accly is INR only (`accounting-core.md:214-215`)                                                      |

## Zoho Books and ERPNext

| Case      | Zoho Books India                                                                                                                                                                                                                                                  | ERPNext v16 (with India Compliance)                                                                                                                                                                                                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `against` | Payments Received, Invoice Payment: Customer Name, Amount, Deposit To, an amount per invoice, "Amount in excess" saved as an excess payment; "Tax Deducted?", Bank charges ([help][z-basic], [API][z-api], [TDS][z-tds], [charges][z-bank])                       | Payment Entry, `payment_type` Receive, "Payment References" rows with `allocated_amount`; the remainder is `unallocated_amount`, credited to the party in the same entry; "Payment Deductions or Loss" ([refs][e-refs], [unallocated][e-unalloc], [deductions][e-ded])                                                  |
| `advance` | Excess Payment with no tax, or the Customer Advance tab for an advance "on which GST is applicable" (Place of Supply, Tax), applied by "Apply to Invoice" with an "Amount to Credit"; Retainer Invoice to Unearned Revenue ([advance][z-func], [retainer][z-ret]) | Payment Entry with no invoice references; Debtors by default, or "Default Advance Received Account" when Company "Book Advance Payments in Separate Party Account" is on; applied through the Sales Invoice "Advances" table or Payment Reconciliation ([Company][e-company], [invoice][e-siadv], [reconcile][e-recon]) |
| `direct`  | Banking, Add Transaction, Money In, "Other Income", with the income account as "From Account"; API types include `other_income`, `interest_income`, `sales_without_invoices` ([KB][z-other], [API][z-bankapi])                                                    | Journal Entry, `voucher_type` "Bank Entry" or "Cash Entry"; a party is required only on Receivable or Payable rows ([voucher types][e-je])                                                                                                                                                                              |

Where they match Accly: one receipt settles several documents with an amount for each,
and a remainder stays with the same customer ([Zoho][z-basic], [ERPNext docs][e-docpe]).
An advance is a liability until applied, and applying it moves no cash ([Zoho][z-ur],
[ERPNext][e-advgl]). One application can be removed ([Zoho][z-cnapply]), like Accly's
`allocation.reverse` (`accounting-core.md:82`).

Where they differ:

- Accly makes the kind a required field. ERPNext infers it from the references,
  and Zoho from the screen used (inference).
- The remainder's account differs. ERPNext keeps it in Debtors when invoice references
  exist, even in separate-account mode ([L259-L285][e-liab]). Zoho "generally" routes an
  excess through Unearned Revenue ([Zoho KB][z-ur]). Accly says only that the remainder
  "becomes advance"; that it credits `customerAdvances` is inference from `posting.ts:79`.
- ERPNext rewrites a submitted Payment Entry at reconciliation ([utils.py][e-recon]); Accly appends Allocation rows.
- Taxable advances: Zoho captures Tax and Place of Supply per advance ([Zoho][z-func]).
  India Compliance posts advance GST, reverses it per invoice and fills GSTR-1 tables
  11A and 11B ([code][ic-pe], [GSTR-1][ic-gstr1], [docs][ic-doc]). Accly refuses them (`accounting-core.md:165`).
- Accly refuses taxable income without an Invoice. I found no such guard in ERPNext's
  Journal Entry party check ([code][e-je]); Zoho's Other Income page shows no tax field.
- Vertical apps: Frappe Education makes one Sales Invoice per student, settled by an
  ordinary Payment Entry ([fee schedule][edu-fs]; no receipt doctype found). Frappe Health
  makes a paid appointment a POS invoice ([appointment][h-appt]). Treatment Counselling
  drafts a reference-less Payment Entry, in effect an inpatient deposit (inference,
  [code][h-tc]). Health has no deposit doctype ([tree][h-tree]).

## Gaps in Accly's model

Ranked by how often the three verticals meet them (the ranking is inference).

1. **`against` not built.** Every fee, bill and dealer invoice needs it (slice 4).
2. **Deductions on a Receipt:** TDS withheld, bank or gateway charges, a small discount
   or write-off. An allocation cannot exceed the Receipt amount (`accounting-core.md:82`),
   so cash plus TDS cannot clear one Invoice (inference).
3. **Counter bill and receipt in one step** for OPD and pharmacy, like Zoho Sales Receipt
   and Health `is_pos`. Call 10 puts embedded settlement under the post grant (`accounting-core.md:68`).
4. **Refund of an unused advance.** Only a Credit Note refund is defined (`accounting-core.md:82`); Zoho refunds from the advance ([Zoho][z-func]).
5. **Tax capture for a taxable service advance.** Each advance Receipt carries
   `advanceSupply`: goods and exempt advances post without GST, while `taxableService`
   is refused until GST advance documents exist.
6. **Refundable security deposits** (caution money, possibly IPD deposits): a liability
   with refund and forfeiture ([s.2(31)][g-s2]). No official Zoho or ERPNext treatment found.
7. **Third-party payer** (insurer, TPA, scholarship). Health moves the claim between
   receivables ([Health][h-ins]); Accly allocates within one Party only.
8. **`direct` to a non-income account** (corpus fund, claim receivable).
9. **Template `supplyClass` review:** trust "Fees" is `taxable` (`chart-templates.ts:165`), wrong for a school trust (inference).

## What this proves / does not prove

It proves from owner sources that Zoho Books India and ERPNext record all three cases,
and names their screens, fields and GL code. It proves the cited tax facts and the Accly
behavior in the current tree. It does not prove runtime behavior: no Zoho India
organization or ERPNext site was used, and ERPNext GL behavior is read from source. The
vertical mappings are inference. Looked for and not found:

- A Zoho page confirming India disables "Sales Without Invoices" (only a search snippet
  of an unanswered community thread).
- Zoho's journal lines for a tax-bearing Customer Advance; GST on retainers; the account
  for payment Bank charges.
- A CBIC ruling on IPD deposits; a refundable-deposit doctype in ERPNext, Education or Health.
- Primary text of CGST Rules 50 and 51 (only the [flyer][g-flyer6]); amendments to
  entries 66 and 74 after 2017; the SGST side of entry 31A.
- Owner text for sections 393 and 394 of the 2025 Act (incometaxindia.gov.in 403).

## Next falsification

- Ask the CA to accept four worked examples: a TPA settlement net of TDS with a disallowance; a dealer
  receipt net of TDS and a bank charge; a school caution deposit; an IPD deposit. A different answer reorders the gaps.
- In a Zoho India trial, post a taxable Customer Advance and a payment with TDS, and
  read the journals. On an ERPNext v16 site, post a receipt with an invoice reference
  and a remainder in separate-account mode; confirm the remainder stays in Debtors.

## Sources

[z-basic]: https://www.zoho.com/in/books/help/payments-received/basic-functions.html
[z-func]: https://www.zoho.com/in/books/help/payments-received/functions.html
[z-ur]: https://www.zoho.com/in/books/kb/accountant/acc-vendor-payments.html
[z-ret]: https://www.zoho.com/in/books/help/retainer-invoice/basic-functions.html
[z-tds]: https://www.zoho.com/in/books/kb/invoices/withhold-taxes.html
[z-bank]: https://www.zoho.com/in/books/kb/banking/record-bank-charges.html
[z-other]: https://www.zoho.com/in/books/kb/banking/record-income-that-hasnt-occured-due-to-sales.html
[z-api]: https://www.zoho.com/books/api/v3/customer-payments/
[z-bankapi]: https://www.zoho.com/books/api/v3/bank-transactions/
[z-sr]: https://www.zoho.com/in/books/help/sales-receipt/create.html
[z-cnapply]: https://www.zoho.com/in/books/help/credit-note/apply-credits.html
[e-party]: https://github.com/frappe/erpnext/blob/4048fb70e14d1843956fcdabb7c3cca75a1cbcdd/erpnext/accounts/doctype/payment_entry/payment_entry.py#L524-L539
[e-refs]: https://github.com/frappe/erpnext/blob/4048fb70e14d1843956fcdabb7c3cca75a1cbcdd/erpnext/accounts/doctype/payment_entry/payment_entry.json#L341
[e-unalloc]: https://github.com/frappe/erpnext/blob/4048fb70e14d1843956fcdabb7c3cca75a1cbcdd/erpnext/accounts/doctype/payment_entry/payment_entry.py#L1095-L1118
[e-liab]: https://github.com/frappe/erpnext/blob/4048fb70e14d1843956fcdabb7c3cca75a1cbcdd/erpnext/accounts/doctype/payment_entry/payment_entry.py#L259-L285
[e-advgl]: https://github.com/frappe/erpnext/blob/4048fb70e14d1843956fcdabb7c3cca75a1cbcdd/erpnext/accounts/doctype/payment_entry/payment_entry.py#L1480-L1587
[e-ded]: https://github.com/frappe/erpnext/blob/4048fb70e14d1843956fcdabb7c3cca75a1cbcdd/erpnext/accounts/doctype/payment_entry/payment_entry.py#L1691-L1712
[e-company]: https://github.com/frappe/erpnext/blob/4048fb70e14d1843956fcdabb7c3cca75a1cbcdd/erpnext/setup/doctype/company/company.json#L766-L870
[e-siadv]: https://github.com/frappe/erpnext/blob/4048fb70e14d1843956fcdabb7c3cca75a1cbcdd/erpnext/accounts/doctype/sales_invoice/sales_invoice.json#L1285-L1310
[e-recon]: https://github.com/frappe/erpnext/blob/4048fb70e14d1843956fcdabb7c3cca75a1cbcdd/erpnext/accounts/utils.py#L508-L577
[e-je]: https://github.com/frappe/erpnext/blob/4048fb70e14d1843956fcdabb7c3cca75a1cbcdd/erpnext/accounts/doctype/journal_entry/journal_entry.py#L597-L607
[e-docpe]: https://docs.frappe.io/erpnext/user/manual/en/payment-entry
[ic-pe]: https://github.com/resilient-tech/india-compliance/blob/071b544ac4440636e643fc383ed67a116a276691/india_compliance/gst_india/overrides/payment_entry.py#L162-L200
[ic-gstr1]: https://github.com/resilient-tech/india-compliance/blob/071b544ac4440636e643fc383ed67a116a276691/india_compliance/gst_india/utils/gstr_1/gstr_1_data.py#L964-L1010
[ic-doc]: https://docs.indiacompliance.app/docs/configuration/other_transaction
[edu-fs]: https://github.com/frappe/education/blob/22e0910d8b4188f17b76e58d7b434354ce5a0e58/education/education/doctype/fee_schedule/fee_schedule.py#L162-L239
[h-appt]: https://github.com/frappe/health/blob/c74fd9b50305acf59641e25d0188f31bdffd85e9/healthcare/healthcare/doctype/patient_appointment/patient_appointment.py#L553-L582
[h-tc]: https://github.com/frappe/health/blob/934d6c162868139dfbe80c23d6102adb7ec25adb/healthcare/healthcare/doctype/treatment_counselling/treatment_counselling.py#L171-L187
[h-ins]: https://github.com/frappe/health/blob/c74fd9b50305acf59641e25d0188f31bdffd85e9/healthcare/healthcare/utils.py#L1105-L1170
[h-tree]: https://github.com/frappe/health/tree/934d6c162868139dfbe80c23d6102adb7ec25adb/healthcare/healthcare/doctype
[g-66]: https://gstcouncil.gov.in/sites/default/files/2024-05/notfctn-66-central-tax-english.pdf
[g-50]: https://gstcouncil.gov.in/sites/default/files/2024-05/50_eng.pdf
[g-flyer6]: https://gstcouncil.gov.in/sites/default/files/e-version-gst-flyers/51_GST_Flyer_Chapter6.pdf
[g-s2]: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter1/section2_v1.00.html
[g-s13]: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter4/section13_v1.00.html
[g-s15]: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter4/section15_v1.00.html
[g-s31]: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter7/section31_v1.00.html
[g-12]: https://cbic-gst.gov.in/hindi/pdf/central-tax-rate/Notification12-CGST.pdf
[g-0422]: https://cbic-gst.gov.in/pdf/central-tax-rate/04_2022-ctr-eng.pdf
[g-0322]: https://cbic-gst.gov.in/pdf/central-tax-rate/03_2022-ctr-eng.pdf
[g-c32]: https://cbic-gst.gov.in/pdf/circularno-32-cgst.pdf
[g-c116]: https://cbic-gst.gov.in/pdf/circular-cgst-116.pdf
[g-c178]: https://cbic-gst.gov.in/pdf/cir-178-08-2022-cgst.pdf
[g-eduflyer]: https://gstcouncil.gov.in/sites/default/files/e-version-gst-flyers/GST_Education_Services.pdf
[it-faq]: https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/tax-payments
[s-c8]: https://taxguru.in/income-tax/circular-82009income-tax-dated-24112009.html
[s-393]: https://blog.tdsman.com/2026/07/tds-on-fees-for-professional-and-technical-services-section-3931-194j/
[s-394]: https://cleartax.in/s/section-394-income-tax-act-2025
