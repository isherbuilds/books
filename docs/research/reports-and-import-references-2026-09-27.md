# Reports and import: reference check, 2026-09-27

Evidence behind [accounting core](../specs/accounting-core.md#slices) slices 6
and 7. ERPNext links are the `develop` or `version-15` branch as read on this
date; pin a commit when implementing against them. Vendor behaviour supports
the shapes below; it does not prove our latency, statutory fitness or
cutover correctness.

For current product behavior, recent user complaints and Indian record duties,
see the [report fit check](./report-fit-and-indian-records-2026-09-27.md).

## Reports (slice 6)

- **Trial balance.** ERPNext takes a fiscal year and `from`/`to`, and shows
  opening, period and closing Dr/Cr with parent rollups
  ([trial_balance.py](https://github.com/frappe/erpnext/blob/develop/erpnext/accounts/report/trial_balance/trial_balance.py)).
  TallyPrime offers period, group or ledger and net views
  ([help](https://help.tallysolutions.com/trial-balance-tally/)). Adopted: leaf
  rows, six columns, opening as the sum before `from`.
- **Account ledger.** ERPNext's General Ledger adds opening, total and closing
  rows with a running `debit - credit` balance
  ([general_ledger.py](https://github.com/frappe/erpnext/blob/develop/erpnext/accounts/report/general_ledger/general_ledger.py)).
  It hides cancelled GL rows by default; our ledger is reversal-only, so both
  the post and the reverse entry show on their own dates.
- **Day book.** TallyPrime's Day Book lists vouchers for a day or period
  ([help](https://help.tallysolutions.com/day-book-tally/)). ERPNext has no
  separate day book report; its General Ledger groups by voucher.
- **P&L and balance sheet.** ERPNext builds income and expense trees and adds
  a provisional profit or loss line to the balance sheet when no period
  closing voucher exists
  ([balance_sheet.py](https://github.com/frappe/erpnext/blob/develop/erpnext/accounts/report/balance_sheet/balance_sheet.py),
  [financial_statements.py](https://github.com/frappe/erpnext/blob/develop/erpnext/accounts/report/financial_statements.py)).
  TallyPrime shows an opening P&L line for earlier years
  ([help](https://help.tallysolutions.com/balance-sheet-tally/)). Adopted:
  current-year and earlier-years rows, no synthetic posting. Neither vendor
  layout proves Schedule III compliance.
- **Exports.** Zoho Books report PDFs carry the Organization name, basis,
  generated date and time, and page numbers
  ([manage reports](https://www.zoho.com/in/books/help/reports/manage-reports.html)).
- **Performance.** ERPNext's GL Entry declares partial indexes on
  `(company, posting_date, account)` and `(company, account, posting_date)
include (debit, credit)` on PostgreSQL, and reads an Account Closing Balance
  checkpoint after a period closing voucher
  ([gl_entry.py](https://github.com/frappe/erpnext/blob/develop/erpnext/accounts/doctype/gl_entry/gl_entry.py)).
  Our journal lines carry no date, so slice 6a measures the join first and
  names the index fallbacks; index-only scans depend on the visibility map
  ([PostgreSQL 18](https://www.postgresql.org/docs/18/indexes-index-only-scans.html)).

## Import (slice 7)

- **ERPNext.** The Opening Invoice Creation Tool takes party, legacy number,
  posting and due dates and the outstanding amount, and submits a Sales or
  Purchase Invoice marked opening against a Temporary Opening account, so each
  opening invoice posts GL; the opening Journal must then exclude the control
  balances. Each invoice commits on its own
  ([guide](https://docs.frappe.io/erpnext/opening-invoice-creation-tool),
  [source](https://github.com/frappe/erpnext/blob/version-15/erpnext/accounts/doctype/opening_invoice_creation_tool/opening_invoice_creation_tool.py)).
  Data Import previews warnings by row, then commits each good document and
  reports partial success
  ([docs](https://docs.frappe.io/erpnext/data-import)).
- **Zoho Books.** One opening figure per customer or vendor, with the
  unexplained difference posted to Opening Balance Adjustments; imports are
  per module with preview and duplicate handling
  ([opening balances](https://www.zoho.com/in/books/help/settings/opening-balances.html),
  [import](https://www.zoho.com/in/books/help/import-export/import.html)).
  Whether a failed row partially commits is not documented.
- **TallyPrime.** A party ledger carries an opening balance split into
  bill-wise New Ref entries with due dates; Excel import records exceptions
  and imports the rest by default
  ([Excel import](https://help.tallysolutions.com/import-data-using-any-excel-file/),
  [getting started](https://help.tallysolutions.com/getting-started-with-importing-data-into-tallyprime/)).

Adopted: bill-wise items with due dates (ERPNext, Tally); control legs derived
from the items inside the one Opening Balance instead of a temporary account or
an adjustment plug; one workbook committed all or nothing, which none of the
three guarantees.
