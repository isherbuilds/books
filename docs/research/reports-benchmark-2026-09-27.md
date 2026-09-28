# Reports benchmark and roadmap, 2026-09-27

Builds on [reports and import references](./reports-and-import-references-2026-09-27.md)
and [report fit and Indian records](./report-fit-and-indian-records-2026-09-27.md).
Those settled slice 6a and the 6b–6d shapes; this note compares the whole
Reports surface with TallyPrime, Zoho Books, Zoho ERP, ERPNext, SAP, Odoo,
Xero and QuickBooks Online, and adds Indian compliance and owner reports.
Evidence is vendor documentation and source as read on this date, not
hands-on tenant trials. Research informs; the founder decides what is built.

This is a pre-6b historical snapshot; its status table describes the code as it stood on 2026-09-27.

## Question

How does Accly's Reports section compare with leading products, and what
should change first, given the owner's priorities: (1) show reports in the
app, not only as downloads; (2) Balance Sheet, P&L and the other core
statements; (3) Tally-style drill-down from any head to the voucher; (4)
Indian compliance and owner reports?

## Answer

Every benchmarked product treats a report as an **interactive in-app view**
first; files are a secondary action. Accly renders one accounting report
(trial balance). GST outward, GST inward, TDS and the one-day day book are
XLSX downloads only. No report row opens anything.

Build one **drill-down spine**, then hang every report on it:

statement (BS / P&L / TB, group tree) → **group summary** → **account
ledger** (with a monthly summary) → **voucher**. Control accounts route to a
party breakdown and GST accounts route to the GST register.

TallyPrime documents exactly this chain and is what Indian CAs use
([browser walkthrough](https://help.tallysolutions.com/tally-reports-in-browser-tally/),
[working with reports](https://help.tallysolutions.com/working-with-reports/)).
ERPNext implements it in source
([financial_statements.js](https://github.com/frappe/erpnext/blob/version-15/erpnext/public/js/financial_statements.js)).
Zoho, Xero and QBO document only parts of it. A consistent chain is where
Accly can match Tally and beat the cloud products.

Order: **R1** in-app statements and the spine (mostly slices 6b–6d plus
three additions) → **R2** owner reports (ageing, cash, comparatives) → **R3**
compliance workbench (GST, TDS, MSME, edit log) → **R4** distribution and
statutory formats.

## Where Accly stands

From code and spec, 2026-09-27.

| Report               | In app                                    | Export    | Drill-down                 | Status                                           |
| -------------------- | ----------------------------------------- | --------- | -------------------------- | ------------------------------------------------ |
| Trial balance        | Yes: leaves, opening/debit/credit/closing | XLSX, PDF | None; account is text      | 6a implemented                                   |
| P&L, Balance sheet   | No                                        | —         | —                          | 6b specified, unbuilt                            |
| Account ledger       | No                                        | —         | —                          | 6c specified, unbuilt                            |
| Day book             | No; one date                              | XLSX      | None                       | 6c replaces with range page                      |
| Party statement      | Yes, party Ledger tab                     | None      | Row → document             | 6d adds header and XLSX/PDF                      |
| GST outward register | No                                        | XLSX      | None                       | B2B, B2CL, B2CS, CDNR, CDNUR, HSN, Exempt sheets |
| GST inward register  | No                                        | XLSX      | None                       | One Bills sheet with eligible/ineligible ITC     |
| TDS register         | No                                        | XLSX      | None                       | Section, PAN, gross, TDS, net                    |
| Home position        | You're owed / You owe / Cash and bank     | —         | Party totals not clickable | Attention lists link to filtered registers       |

Sources: `apps/web/src/routes/$orgSlug/reports.tsx:43-220`,
`apps/web/src/routes/$orgSlug/reports_.trial-balance.tsx:136-206`,
`packages/api/src/routers/export.ts:109-440`,
`apps/web/src/routes/$orgSlug/parties_.$partyId.ledger.tsx:30-76`,
`apps/web/src/routes/$orgSlug/index.tsx:111-193`,
[accounting core slice 6](../specs/accounting-core.md#slices).

Deferred in the spec and relevant here: comparative and monthly columns,
ageing buckets, cash-basis reports, Schedule III, year-end close, report
pagination ([Deferred](../specs/accounting-core.md#deferred)). Out of scope,
each for its own spec: GST return JSON, IMS, TDS returns, e-invoice, e-way
bill, MSME §37(2)(g) ageing.

## Comparison

✓ documented; ◐ partial or plan-dependent; — searched and not found in the
sources read (not proof of absence); ? not checked in this pass.

| Capability                                    | Tally | Zoho Books | Zoho ERP | ERPNext | Odoo | SAP B1 / S4 | Xero | QBO | Accly  |
| --------------------------------------------- | ----- | ---------- | -------- | ------- | ---- | ----------- | ---- | --- | ------ |
| BS / P&L rendered in app                      | ✓     | ✓          | ✓        | ✓       | ✓    | ✓ / ✓       | ✓    | ✓   | —      |
| Group tree expand/collapse                    | ✓     | ?          | ?        | ✓       | ✓    | ✓ / ✓       | ?    | ✓   | —      |
| Row → ledger → voucher, documented end to end | ✓     | ◐          | ?        | ✓       | ✓    | ◐ / ◐       | ◐    | ◐   | —      |
| Ledger monthly summary                        | ✓     | ?          | ?        | ?       | ?    | ?           | ?    | ?   | —      |
| Period / monthly columns                      | ✓     | ✓          | ✓        | ✓       | ✓    | ✓ / ✓       | ✓    | ✓   | —      |
| Cash flow statement                           | ✓     | ✓          | ✓        | ✓       | ✓    | ? / ✓       | ✓    | ?   | —      |
| AR/AP ageing, bill-wise                       | ✓     | ✓          | ✓        | ✓       | ✓    | ◐ / ✓       | ✓    | ✓   | —      |
| Ratios                                        | ✓     | ✓          | ✓        | ✓       | ◐    | ?           | ◐    | ◐   | —      |
| GSTR-1 / 3B views                             | ✓     | ✓          | ?        | ✓ (app) | ◐    | ? / ✓       | n/a  | n/a | XLSX   |
| GSTR-2B / IMS reconciliation                  | ✓     | ✓          | ?        | ?       | ✓    | ? / ?       | n/a  | n/a | —      |
| Form 140 / 143 labels (TY 2026-27)            | ✓ 7.1 | legacy     | ?        | ?       | ?    | ?           | n/a  | n/a | spec ✓ |
| Edit log / audit trail report                 | ✓     | ✓          | ?        | ?       | ✓    | ?           | ?    | ?   | —      |
| Schedule III statements                       | ✓ 7.1 | ◐          | ✓        | ◐ v16   | —    | ?           | n/a  | n/a | —      |
| Saved views                                   | ✓     | ◐          | ?        | ?       | —    | ◐ / ?       | ✓    | ✓   | —      |
| Scheduled email                               | ?     | ✓          | ?        | ✓       | —    | ?           | —    | ✓   | —      |
| Owner dashboard linking into reports          | ✓     | ✓          | ✓        | ?       | ?    | ?           | ✓    | ✓   | ◐      |

Evidence per product:

- **TallyPrime 7.1** (May 2026). Balance Sheet → group → sub-group → ledger
  monthly summary → month's vouchers → voucher; Enter drills,
  Shift+Enter expands one line, Alt+F1/Alt+F5 expands all, F2 period, F12
  configure, Ctrl+B basis, Ctrl+F filter, Ctrl+J exceptions, Ctrl+L save
  view, auto columns for months, prior year or companies; Alt+G searches all
  reports. Catalogue includes Group Summary, Group Vouchers, Cash/Bank Books,
  Cash Flow, Funds Flow, Ratio Analysis, bill-wise outstandings by bill or due
  date, GSTR-1/3B/2A/2B/IMS, TDS outstandings, challan reconciliation, Edit
  Log and, from 7.1, Schedule III Division I and Forms 140/143
  ([report guide](https://help.tallysolutions.com/working-with-reports/),
  [accounting reports](https://help.tallysolutions.com/accounting-financial-reports-tally/),
  [balance sheet](https://help.tallysolutions.com/balance-sheet-tally/),
  [filters](https://help.tallysolutions.com/apply-filter-in-reports/),
  [receivables](https://help.tallysolutions.com/manage-receivables-outstanding-tally/),
  [TDS reports](https://help.tallysolutions.com/tds-reports-tally/),
  [7.1 release](https://help.tallysolutions.com/release-notes-tallyprime-7-1/),
  [dashboard](https://help.tallysolutions.com/dashboard/)). Shortcut bindings
  vary by report; copy the functions, not the keys.
- **Zoho Books India.** Run Report renders a table or chart; P&L, BS and Cash
  Flow support cash/accrual, compare with previous periods, account filters;
  account clicks open detail; AR ageing drills to invoice ageing; dashboard
  receivables, payables, expense slices and bank cards open reports. Custom
  reports are limited to P&L, BS, Cash Flow and Invoice Details; scheduled
  email is permission- and plan-gated; Detailed GL is an async export.
  Schedule III variants appear in release notes but not the current guide;
  TDS/TCS labels are still 26Q/27EQ
  ([business overview](https://www.zoho.com/in/books/help/reports/business-overview.html),
  [manage reports](https://www.zoho.com/in/books/help/reports/manage-reports.html),
  [receivables](https://www.zoho.com/in/books/help/reports/receivables.html),
  [home](https://www.zoho.com/in/books/help/home/),
  [GST hub](https://www.zoho.com/in/books/help/gst/),
  [detailed GL](https://www.zoho.com/in/books/kb/reports/detailed-general-ledger.html)).
- **Zoho ERP.** Documents Schedule III P&L/BS, a Reports Center, role-based
  and custom dashboards; multi-org analytics is a Zoho Analytics import with
  1–24 h sync, not proven consolidation
  ([business overview](https://www.zoho.com/en-in/erp/help/analytic-reports/business-overview.html),
  [dashboards](https://www.zoho.com/en-in/erp/help/dashboard/overview-dashboard.html),
  [Analytics connector](https://www.zoho.com/analytics/help/connectors/zoho-erp.html)).
- **ERPNext v15.** Statement tree with monthly/quarterly/yearly columns and
  an accumulate switch; an account row opens the General Ledger carrying
  company, dates and dimensions, and receivable/payable accounts open AR/AP
  instead; GL voucher numbers open the document. Account Closing Balance
  snapshots seed statements after a period close. India Compliance adds GST
  registers, HSN summaries, GSTR-3B details, e-invoice summary, GSTR-1 and
  3B workflows. Financial Report Template is v16, not v15
  ([statement JS](https://github.com/frappe/erpnext/blob/version-15/erpnext/public/js/financial_statements.js),
  [report folder](https://github.com/frappe/erpnext/tree/version-15/erpnext/accounts/report),
  [closing balance query](https://github.com/frappe/erpnext/blob/version-15/erpnext/accounts/report/financial_statements.py#L445-L480),
  [India Compliance reports](https://github.com/resilient-tech/india-compliance/tree/develop/india_compliance/gst_india/report)).
- **Odoo 18.** Lines unfold to entries; comparison menu; PDF/XLSX;
  `account.report` expression engine; India GSTR-1 validated then shown as a
  spreadsheet; GSTR-2B reconciliation
  ([reporting](https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting.html),
  [India](https://www.odoo.com/documentation/18.0/applications/finance/fiscal_localizations/india.html)).
- **SAP.** B1 financial report templates regroup accounts without changing
  the chart; Web Client P&L puts year/quarter/month in columns. S/4HANA Cloud
  multidimensional BS/P&L drills to G/L line items and compares years, ledgers
  and plan
  ([B1 templates](https://help.sap.com/saphelp_sbo91/helpdata/en/45/10c8c90b9941dfe10000000a1553f6/content.htm?no_cache=true),
  [B1 Web Client](https://help.sap.com/docs/SAP_BUSINESS_ONE_WEB_CLIENT/2554bf7e9aa347729b0547a737e123ac/44318cf7af0f4c859985f844e1272bc0.html),
  [S/4 multidimensional](https://help.sap.com/docs/SAP_S4HANA_CLOUD/0fa84c9d9c634132b7c4abb9ffdd8f06/d8d608a19a5449f9916fc5a2ff8fb12f.html)).
- **Xero.** P&L figures open Account Transactions; compare periods or
  tracking columns (not both); layout editor with formulas; Management Report
  pack; favourites; short-term cash flow in paid Analytics Plus; native
  scheduled email not found
  ([P&L](https://central.xero.com/0/article/Profit-and-Loss-New),
  [layout editor](https://central.xero.com/0/article/Edit-layout-of-a-new-financial-report),
  [Analytics Plus](https://central.xero.com/0/article/About-Xero-Analytics-Plus)).
- **QBO** (not sold in India; UX benchmark only). Collapse/expand rows,
  display columns by month, compare previous period with ₹/% change, % of
  income, saved custom reports with scheduled email, management report packs
  ([customize](https://quickbooks.intuit.com/learn-support/en-us/help-article/customize-reports/customize-reports-quickbooks-online/L0gKmSawG_US_en_US),
  [schedule](https://quickbooks.intuit.com/learn-support/en-us/help-article/email-reports/set-schedule-email-information-memorized-report/L0pQ4ifGJ_US_en_US)).
- **Indian SMB tools.** Vyapar ships bill-wise profit, party-wise P&L, cash
  flow, balance sheet and GSTR views; BUSY ships MIS profitability by bill,
  party and salesman, ageing, ratios; Marg ages collections by salesman and
  route; myBillBook says its GST reports do not file returns
  ([Vyapar](https://vyaparapp.in/blog/vyapar-app-features/),
  [BUSY MIS](https://busy.in/faqs/mis-reports/mis-reports/1/),
  [Marg](https://care.margcompusoft.com/margerp/sale-analysis/40939/1/How-to-see-area-wise),
  [myBillBook](https://mybillbook.in/s/features/gst-reports/)).

## Indian compliance facts that change labels or shapes

- **TDS/TCS forms, tax year 2026-27 onward:** 138 = 24Q, 140 = 26Q,
  141 = 26QB/QC/QD/QE, 142 = 26QF, 143 = 27EQ, 144 = 27Q; certificates
  130 = Form 16, 131 = 16A; 121 = 15G/15H; 128 = lower deduction. Periods
  through 31 March 2026 keep the old forms; the switch follows the earlier of
  credit or payment
  ([form map](https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-06/Navigator%201.pdf),
  [TDS transition](https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/tds-compliance),
  [Form 131 FAQ](https://www.incometaxindia.gov.in/documents/d/guest/form-131-faqs)).
  §206AB was omitted from 1 April 2025
  ([text](https://www.incometaxindia.gov.in/w/section-206ab-5)). TDS credit
  for tax year 2026-27 appears in Form 168, not only 26AS.
- **Tax audit:** FY 2025-26 uses 3CA/3CB/3CD (due 30 September 2026); tax
  year 2026-27 uses consolidated Form 26
  ([forms FAQ](https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/%20income%20tax%20forms-faq)).
- **GSTR-1 Table 12 (HSN):** separate B2B and B2C tabs since May 2025; 4
  digits minimum at AATO ≤ ₹5 crore, 6 above; UQC and quantity per row.
  **Table 13 (documents issued)** is mandatory from the May 2025 period
  ([GSTN advisory](https://tutorial.gst.gov.in/downloads/news/updated_advisory_hsn_table12_25042025.pdf)).
  Accly's HSN sheet emits HSN/SAC, rate and tax only, one tab, no UQC or
  quantity (`packages/api/src/routers/export.ts:389-399`), and Table 13 is
  deferred. A CA preparing GSTR-1 from it must fill the gap by hand.
- **GSTR-1A** corrects the same period after GSTR-1 and before GSTR-3B; 3B
  outward values are reported as locked to GSTR-1/1A from July 2025
  (secondary source; exact scope unverified)
  ([GSTR-1A FAQ](https://tutorial.gst.gov.in/downloads/news/creative_faqs_on_gstr1a_fo_cr25785.pdf)).
- **IMS**: accept / reject / pending / deemed accepted drives GSTR-2B;
  action closes once that month's 3B is filed
  ([IMS advisory](https://tutorial.gst.gov.in/downloads/news/revised_advisory_on_ims.pdf)).
- **Rule 37:** ITC reverses if the supplier is unpaid 180 days after the
  invoice date; reclaim on payment
  ([Circular 170](https://cbic-gst.gov.in/pdf/Circular-170-02-2022-GST.pdf)).
  Computable today from Bills with eligible ITC and their settlement.
- **e-invoice:** AATO > ₹5 crore; AATO ≥ ₹10 crore must report IRN within
  30 days ([IRP notice](https://einvoice1.gst.gov.in/Documents/advisory270325.pdf)).
  **GSTR-9C** self-certified above ₹5 crore
  ([Circular 246](https://cbic-gst.gov.in/pdf/cir-cgst-246-03-2025.pdf)).
- **Schedule III ageing (companies):** receivables from due date, undisputed
  / disputed × good / doubtful, < 6 m, 6 m–1 y, 1–2 y, 2–3 y, > 3 y;
  payables MSME / others / disputed, < 1 y, 1–2 y, 2–3 y, > 3 y; unbilled
  separately ([MCA 2021 amendment](https://www.mca.gov.in/Ministry/pdf/ScheduleIIIAmendmentNotification_24032021.pdf)).
- **MSME:** payment within the written term, capped at 45 days, or 15 days
  without one; interest at 3× bank rate compounded monthly; MSME Form I
  half-yearly for companies
  ([MSMED Act §§15–16](https://samadhaan.msme.gov.in/WriteReadData/DocumentFile/MSMED2006act.pdf),
  [Form I kit](https://www.mca.gov.in/content/dam/mca-aem-forms/instructionkits/Instruction%20Kit_MSME%20Form%20I.pdf)).
  Accly has no MSE classification on a Party.
- **Edit log:** companies keeping books in software need an audit trail per
  transaction that cannot be disabled, from 1 April 2023
  ([ICAI](https://cajournal.icai.org/article-details/audit-trail-requirements-responsibilities)).
  Posting is append-only; the edit log for drafts and masters still needs CA
  verification ([product](../product.md)).

Unverified and not to be hard-coded: the exact 3B lock scope, the 2026 TDS
deposit and return due dates for new forms, Rule 86B exceptions, the Form 26
field schema, and the 2025 Act section number for the MSME disallowance.

## Recommendations

### R1. Reports in the app, with a drill-down spine (start here)

Tags against the [accounting core](../specs/accounting-core.md#slices):
**spec** is already specified, **gated** is Deferred behind a named gate,
**new** is in neither.

1. **One report page pattern (spec, palette new).** Period or as-of control in the URL (already
   the 6a pattern), the `ReportHeader` on screen, "period not closed", totals
   pinned, Download XLSX and PDF as secondary actions. Every report is
   reachable from the Reports index and the command palette (Tally's Alt+G).
2. **P&L and Balance Sheet (spec 6b; expand/collapse and leaf links new)** as group trees: inline expand/collapse per
   group and an Expand all toggle (Tally Shift+Enter and Alt+F1; ERPNext
   depth 3). Every group and leaf is a link.
3. **Group summary (new).** `/reports/group?accountId=&from=&to=`: the
   group's direct children with opening, debit, credit and closing. It is the
   trial balance restricted to a subtree, read through the existing
   `accountActivity`, so no second data path. Tally's Group Summary. Also a
   **group view of the trial balance** (groups with subtotals), which the 6a
   leaf list lacks.
4. **Account ledger (spec 6c) with a Monthly toggle (new).** Month rows with
   debit, credit and closing; a month opens the ledger for that month (Tally
   Ledger Monthly Summary). Trial balance, group summary and statement leaves
   link here for the same period.
5. **Voucher (spec 6c).** Ledger and day book rows open the document route by
   `documentType`/`documentId`, as the party Ledger does; an allocation stays
   unlinked, per 6c.
6. **Control-account routing (new).** Receivables and Payables open a
   party-wise balance list, then the party statement, then the document
   (ERPNext routes these to AR/AP). Party statements sum to the control
   account by construction (slice 9), so the numbers reconcile. A plain
   ledger of Receivables would be thousands of lines with no party context.
   GST and TDS accounts open the matching register rows.
7. **Day book range page (spec 6c)** and **party statement exports (spec 6d)**.
8. **Render the GST and TDS registers in the app (new).** Same builders as
   the XLSX, tabs per sheet, each row linked to its document. Correct the
   TDS form label by period (Form 140 for tax year 2026-27, 26Q before).
9. **Keyboard (new).** Enter drills, Backspace or browser Back returns with the
   period intact. No motion on drill, per the AGENTS.md motion rule.

Acceptance for the spine: from a Balance Sheet line, reach the voucher that
moved it in at most four clicks with the period carried; each level's total
equals the row that opened it.

### R2. Owner reports

1. **Receivables and payables ageing (gated)** as of a date: bill-wise, by due date,
   buckets 0–30 / 31–60 / 61–90 / 90+, party → bills → document. Home's
   "You're owed" and "You owe" link here (they are not links today). Lifts
   the deferred "ageing buckets" gate. Feasible with current data: documents
   carry due dates and allocation rows carry `entryDate`
   (`packages/db/src/schema/allocations.ts:30`), so outstanding as of a past
   date is computable.
2. **Cash and bank book (spec 6c, as an account ledger)** and a
   **cash summary**: money in and out by counter-account for the period,
   direct method, labelled as not a statutory cash flow statement (Xero Cash
   Summary; Zoho's dashboard chart is direct method too).
3. **Comparative columns (gated)** on P&L and BS: previous period, same period last
   year, months of the year, with ₹ and % change. Lifts the deferred
   "comparative and monthly columns" gate.
4. **Sales by party (new)** and top-customer concentration from Invoices net of
   Credit Notes. Call it sales, not profit: there is no cost attribution.
5. **Income and expense trend (new)** on Home, each bar opening the month's P&L.
6. **GST payable estimate (new)** for the open period: output less eligible input
   from books, flagged as unreconciled to GSTR-2B.

### R3. Compliance workbench

1. **GSTR-1 view (new; Table 13 gated)** from the outward register: B2B, B2CL, B2CS, CDNR,
   CDNUR, Exempt, **HSN split B2B/B2C with UQC and quantity**, **Table 13
   document summary** (new, currently deferred), with exceptions (missing
   GSTIN, HSN digits below the turnover rule, number series gaps). Each row
   opens its document.
2. **GSTR-3B summary from books (new)**: 3.1, 3.2, Table 4 eligible/ineligible ITC,
   set against the GST control accounts, so a CA sees books vs return before
   filing.
3. **Rule 37 180-day ITC exposure (new)**: Bills with eligible ITC unpaid at 150
   and 180 days. Feasible with current data.
4. **TDS payable by section and month (new; challans gated)**, open vs deposited; challan data is
   deferred, so start with payable and the TDS Payable ledger. **TDS
   receivable register** by customer, to reconcile with Form 168 / 26AS.
5. **MSME payables (out of scope today; needs schema)**: needs an MSE classification (Udyam) and agreed term on
   the Party. Then a 45-day overdue list, which also feeds Schedule III and
   the tax audit.
6. **Edit log report (new)** for companies: document and master changes by actor
   and time, from what the product already records. Confirm with a CA what
   the rule needs beyond append-only posting.
7. **GSTR-2B / IMS reconciliation (out of scope today; promised in [product](../product.md))** needs a 2B import and its own spec (out
   of scope today); it is the report GST practitioners spend days on
   ([discussion](https://www.reddit.com/r/IndiaTax/comments/1q6md1y/anyone_else_spending_days_on_gstr2b/)).

### R4. Later

Schedule III Division I statements and ageing notes for companies (gate: a
CA asks for statutory accounts from Accly), indirect cash flow (needs
current/non-current classification), ratios, cash-basis reports, saved
views, scheduled email and an opt-in WhatsApp owner digest with a deep link,
budgets, cost centres, multi-organization summaries.

## Decisions for the founder

1. R2.1 and R2.3 lift two Deferred gates ("a pilot CA asks") on the owner's
   request. Record that as a founder decision in the spec, or wait for a CA.
2. Group summary, monthly ledger summary, control-account routing and
   in-app registers (R1.3, R1.4, R1.6, R1.8) are new scope for slice 6.
   Add them to 6b/6c or as a 6e.
3. The HSN sheet gap (B2B/B2C split, UQC, quantity) and Table 13 affect any
   GST-registered pilot filing from Accly's registers. Ask the pilot CA
   whether it blocks acceptance.

## What this proves and does not prove

It proves which report surfaces and drill paths vendors document and that
Accly lacks them today. It does not prove owner or CA demand, report
latency, statutory fitness of any layout, or the final hop to the voucher in
Zoho, Xero, QBO and SAP B1, which their docs do not show end to end.

## Next falsification

- Click Balance Sheet → group → ledger → voucher in a live Tally, Zoho Books
  India and ERPNext company, and time it against Accly's R1 build.
- Give one pilot CA the R1 spine on real books for a month-end review;
  record every point where they fall back to an XLSX.
- Measure the group summary and monthly ledger queries with
  `bun run benchmark:rpc` at volume against the 100 ms report budget.
- Check the live GST portal for the 3B lock scope and Table 12 validation
  before building R3.1–R3.2.
