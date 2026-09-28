# Report fit and Indian records, 2026-09-27

## Question

Does the trial balance and the planned report sequence fit established accounting
workflows and Indian record duties? What do recent user complaints change?

## Answer

Keep slice 6a small. Its dated opening, movement and closing columns match the
current trial balance shape in [Zoho Books India](https://www.zoho.com/in/books/kb/reports/can-i-view-the-trial-balance-report-with-opening-and-closing-balances.html),
[TallyPrime](https://help.tallysolutions.com/trial-balance-tally/) and
[ERPNext](https://docs.frappe.io/erpnext/accounting-reports). Finish the planned
account ledger and voucher drilldown so a CA can explain a balance. Keep GST,
TDS and statutory statements separate. A trial balance is a reconciliation
report; these sources do not establish it as a statutory filing format.

Before a real company or GST-registered pilot uses Accly as its primary books,
its adviser must confirm the applicable edit-log, retention, backup and filing
duties. The existing [pilot gate](../operations.md#pilot-readiness) requires that
review; neither this research nor a correct trial balance proves compliance.

## Evidence

### Report behavior

| Product                                                                                                                                    | Observed current behavior                                                                                                                                                                            | What it means here                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Zoho Books India](https://www.zoho.com/in/books/kb/reports/can-i-view-the-trial-balance-report-with-opening-and-closing-balances.html)    | A date-range trial balance can show opening and closing balances. [P&L accounts drill into transactions](https://www.zoho.com/in/books/help/reports/business-overview.html).                         | Keep the six trial balance amounts. Add account drilldown in the planned detail slice.                                                                   |
| [TallyPrime](https://help.tallysolutions.com/trial-balance-tally/)                                                                         | Period trial balance shows debit/credit differences and opens ledger detail. Its [report guide](https://help.tallysolutions.com/working-with-reports/) documents company, report and period context. | Keep the organization and period visible in exports. A balance needs a path to its ledger.                                                               |
| [ERPNext](https://docs.frappe.io/erpnext/accounting-reports)                                                                               | Trial balance shows opening, movement and closing by account. Its [general ledger](https://docs.frappe.io/erpnext/general-ledger) exposes the entries behind a balance.                              | The existing report sequence is sound; do not add a second trial balance data path.                                                                      |
| [SAP Business One 10.0](https://help.sap.com/docs/SAP_BUSINESS_ONE/68a2e87fb29941b5bf959a184d9c6727/93e767df61654a33848e283f841caa7f.html) | Trial balance can include business-partner and control-account detail.                                                                                                                               | Accly's separate party statement can explain control balances without duplicating them in the trial balance. This is an inference from our ledger model. |

The same separation appears elsewhere. [QuickBooks Online](https://quickbooks.intuit.com/learn-support/en-us/help-article/purchase-orders/reports-included-quickbooks-online-subscription/L0s4KrGgr_US_en_US)
lists trial balance and general ledger as distinct reports; its
[Advanced reporting guide](https://quickbooks.intuit.com/learn-support/en-us/help-article/customize-reports/using-quickbooks-online-advanced-reporting-tools/L20nzyDtH_US_en_US)
offers spreadsheet templates for detailed analysis. [Xero's general ledger guide](https://central.xero.com/0/article/General-Ledger-report)
describes period movement with optional opening and closing balances.
[Odoo's reporting guide](https://www.odoo.com/documentation/17.0/applications/finance/accounting/reporting.html)
describes expandable account and journal detail, PDF/XLSX export and period
comparison. These confirm useful future paths; they do not make those options
requirements for Accly's first trial balance.

[Zoho's detailed general ledger export](https://www.zoho.com/in/books/kb/reports/detailed-general-ledger.html)
may process large exports asynchronously. [Zoho report options](https://www.zoho.com/in/books/help/reports/business-overview.html)
include comparisons and customization. These are real product patterns, but they
do not prove Accly needs queues, unlimited exports, dimensions or comparative
columns in 6a. The [accounting spec](../specs/accounting-core.md#slices) assigns
detail bounds to later slices and defers comparison until a pilot CA asks.

### Recent complaints, not measured prevalence

| Source and date                                                                                                                                                                                 | User report                                                                                           | Design check                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [ERPNext forum, June 2026](https://discuss.frappe.io/t/trial-balance-report-bug/162886)                                                                                                         | A user says later advance reconciliation changed opening columns. The cause is unverified.            | Keep opening based on dated journal entries; test later allocation against an earlier report. |
| [ERPNext forum, May 2026](https://discuss.frappe.io/t/most-report-in-erpnext-takes-about-5-to-minutes-to-run-when-database-in-1-year-old/162379)                                                | A user reports reports taking minutes at about 1,000 invoices per day. The workload is self-reported. | Complete Accly's specified native PostgreSQL p95 and query-plan check.                        |
| [Zoho user, January 2026](https://www.reddit.com/r/Zoho/comments/1qr2oej/zoho_books_keeps_creating_opening_balances_after/)                                                                     | A migrating user reports duplicate opening balances; no cause is established.                         | Reconcile cutover balances to the source trial balance before posting.                        |
| [SAP community, December 2025](https://community.sap.com/t5/financial-management-q-a/period-end-closing-pec-utility-posting-to-main-branch-instead-of-individual/qaa-p/14293206/highlight/true) | A user reports branch and consolidated closing balances that disagree.                                | Preserve explicit organization scope; group reporting needs a separate decision.              |
| [Zoho Books India discussion, September 2025](https://www.reddit.com/r/Zoho/comments/1nhg765/people_who_using_zoho_books_in_india_how_do_file/)                                                 | A user asks for in-app non-salary TDS filing; Zoho staff says it is unavailable.                      | Name Accly's TDS register as preparation evidence, not filing.                                |
| [GST practitioner discussion, January 2026](https://www.reddit.com/r/IndiaTax/comments/1q6md1y/anyone_else_spending_days_on_gstr2b/)                                                            | A user describes invoice-level GSTR-2B mismatches and supplier follow-up.                             | Future GST reconciliation needs exceptions at invoice level, not a trial balance widget.      |

I found no strong recent independent first-person TallyPrime trial balance defect
report. The complaints above are individual accounts. They do not establish defect
rates, vendor-wide behavior or customer demand for a specific Accly feature.

### Indian records and filing boundaries

| Source                                                                                                                                                                                                                                                                               | Applies when                                                    | Consequence                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Companies Act 2013, sections 128–129](https://www.mca.gov.in/Ministry/pdf/CompaniesAct2013.pdf) and [Companies (Accounts) Rule 3 amendments](https://www.mca.gov.in/bin/ebook/dms/getdocument?doc=MTcyODIyOTI0&docCategory=Notifications&type=open)                                 | An Indian company maintains electronic books in Accly.          | Confirm accrual/double-entry records, eight-financial-year retention, transaction edit history, and daily India-located backups. Annual Schedule III statements require their own reviewed layout and disclosures; the planned management P&L and balance sheet must not claim that status. |
| [CGST Act, sections 35–36](https://cbic-gst.gov.in/pdf/CGST-Act-Updated-31082021.pdf) and [CBIC accounts and records rules](https://cbic-gst.gov.in/accnt-record-rules.html)                                                                                                         | The Organization is GST registered.                             | Keep source vouchers, supply/tax/ITC records and logs of electronic edits or deletions; confirm the statutory retention period, including any proceeding extension. The trial balance alone does not meet these duties.                                                                     |
| [GST portal GSTR-2B FAQ](https://tutorial.gst.gov.in/userguide/returns/FAQ_gstr2b.htm)                                                                                                                                                                                               | The Organization claims input tax credit.                       | GSTR-2B is supplier-derived and read-only. Books data must be reconciled before GSTR-3B; a books-only register is not a match result.                                                                                                                                                       |
| [Income-tax Act 2025, section 62](https://www.incometaxindia.gov.in/w/section-62-134) and [Income-tax Rules 2026, Rule 46](https://www.incometaxindia.gov.in/documents/81799/11848482/En-Notified-IT-Rules-2026-20-03-2026.pdf/a332bf2a-da14-8b94-dde2-5a2ea1428318?t=1773990110473) | Entity, profession and receipts meet the applicable thresholds. | Have the pilot adviser classify the entity and its electronic-books and backup duties. A medical practice can have a separate daily case-register duty; do not infer it for every hospital.                                                                                                 |
| [Income Tax Department Form 140 guidance](https://www.incometaxindia.gov.in/documents/d/guest/fn-140)                                                                                                                                                                                | Non-salary TDS is deducted from resident payments.              | A quarterly statement is a filing task. A TDS register supports it but does not file it.                                                                                                                                                                                                    |

## What this proves and does not prove

The sources support the current report order and a separate compliance review.
They do not prove Accly's trial balance is correct at pilot volume, that its
audit and backup implementation meets every applicable rule, or that a vendor
complaint is reproducible. The seeded company and trust do not establish the
real pilot's legal form, GST status or whether Accly will be its primary books.

## What this means for us

1. Finish the 6a native PostgreSQL measurement and verify the current PDF and
   XLSX with a representative Organization. Keep one guarded report builder for
   all three formats.
2. Build the planned ledger and voucher path next. Verify that later allocation
   and cancellation leave a prior period's journal-based report unchanged.
3. Preserve the [statutory-statements deferral](../specs/accounting-core.md#deferred)
   until a CA asks for and validates the required layout and disclosures.
4. At pilot selection, record each entity's legal form, GST registration,
   profession, primary-books role and adviser. Verify its audit, retention,
   backup and filing duties against the current rules before go-live.

## Next falsification

Ask the pilot CA to reconcile one month-end trial balance to the ledger and
source vouchers, including a later cancellation and allocation. Time the
365-day report on native PostgreSQL at the specified volume. Have the pilot's
adviser review the exact deployment, audit history and backup evidence against
its legal and tax status.

## Sources

The evidence tables and paragraph link each claim to its source. Product
behavior comes from the linked Zoho Books, TallyPrime, ERPNext, SAP,
QuickBooks, Xero and Odoo documentation. Complaint
examples come from the linked user posts and forum threads. Legal duties come
from the linked MCA, CBIC, GST portal and Income Tax Department publications.
