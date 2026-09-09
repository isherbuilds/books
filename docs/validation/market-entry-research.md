# The Compliance-Native Ledger

Market-entry research for a new accounting and billing product. India first. 2026-09-08.

Method: two low-cost search agents (competitors; market, compliance, integrations), one verifier that tried to refute the 13 most load-bearing claims (10 confirmed, 2 refuted, 1 unverified), then a final synthesis pass that corrected one wrong conclusion in the agents' draft. Every number is cited. Unverified items are marked.

## 0. Revised verdict after independent review (read this first)

A second, stronger model reviewed this report against the live products and refuted the wedge as written. **TallyPrime 6.1 "Connected GST" already ships books + IRN + e-way bill + GSTR-2B reconciliation + IMS + direct GSTR-1/3B filing + a back-dated lock, inside Tally** [27]. **Zoho Books India ships the same set in the cloud from 749 rupees a month, is itself a GSP, and runs an ICAI-affiliated CA partner programme** [28][29]. **Busy adds TDS, MSME 43B(h) and inventory on top** [30]. "You never open a second tool" is therefore not a differentiator against current releases.

What survives, narrower: **a cloud, multi-organization, CA-first ledger differentiated on ledger integrity, not on compliance coverage.** Append-only journal with reversal-only corrections, a Companies Act grade edit log, a hard lock keyed to filed returns, and one workspace for a CA firm across all client entities. Compliance coverage becomes table stakes that must match Tally and Zoho, not the pitch.

The MVP scope also under-served the chosen 2 to 50 crore segment. It must add: TDS deduction on vendor payments (194C/J/H/I/Q, challan and 26Q export), MSME 43B(h) 15/45-day flags with Udyam numbers, basic stock items with HSN, UQC and closing stock, and foreign-currency export invoices under LUT. Only TDS return e-filing, manufacturing and a customer portal stay excluded.

Other corrections from the review: Zoho's India prices are 899 to 9,999 rupees a month, not the USD Capterra tiers; Tally's "80%+ share" is reseller folklore, say "dominant, 2 to 3M paid users, share unsourced"; GSP access is not an open question, apply as an ASP under a GSP with usage pricing and a second GSP for failover; IMS gained a "pending" option for credit notes and partial ITC reversal in October 2025; the Income-tax Act 2025 renumbers TDS sections from 1 April 2026; record retention is 8 years under the Companies Act and 72 months under CGST section 36 (not web-verified this session). The CA channel needs an explicit offer (free firm workspace, revenue share or migration service) because Zoho already gives CAs three years free.

Full review findings are in section 13. Sections 1 to 12 below are the original draft, kept for the evidence they carry.

## 1. Verdict (original draft, superseded by section 0)

**Wedge: books where compliance is a property of the ledger, sold to CA-referred B2B businesses of roughly 2 to 50 crore turnover.**

Today an Indian business runs its books in one tool (Tally, Busy, Zoho Books) and its GST compliance in another (ClearTax, Suvit, the GST portal, Excel), with the CA in between over WhatsApp and Tally backups. Reconciliation tools exist only because the books do not own compliance. The product that removes the second tool is books in which every document carries its own compliance state:

- an invoice knows its IRN status, its e-way bill, its IMS state at the buyer, its GSTR-2B match, and its payment state;
- GSTR-1 and GSTR-3B are always-ready views over the ledger, never an export;
- the period locks when the return is filed, so back-dated edits cannot break a filed return;
- the CA is a member across client organizations with the same live data as the owner.

That is the day-one difference: "you never export to another tool." Everything else (invoicing, receipts, reports) must be flawless but is table stakes.

**Why now.** The Invoice Management System (IMS) went live in October 2024 and makes buyer-side action on every supplier invoice a live, recurring task [19]. The 30-day IRN reporting cap started at 100 crore, dropped to 10 crore in April 2025, and is trending down [16][17]. Intuit pulled QuickBooks out of India in 2023 because continuous GST localization cost more than the revenue, proof that compliance depth is a moat, not a feature [3]. Vyapar has absorbed Suvit into "Vyapar TaxOne", so incumbents are already merging the billing and CA layers; the window is open but not for long [23].

**Who buys.** The CA firm recommends and often operates the books; the business owner pays. One CA relationship brings 20 to 50 businesses.

## 2. Where the agents' draft was wrong

The verifier and my own checks changed three conclusions. Keep these in mind if you read the raw agent output.

1. The draft said "no incumbent owns CA multi-client GST reconciliation." False. ClearTax Compliance Cloud reconciles 2B against purchase registers for firms with 50+ clients [24]; Suvit (now Vyapar TaxOne) sells a multi-client CA workspace from about 8,000 rupees a year [23][25]; TaxSolver, IRIS and others compete too. A reconciliation-only product would enter a crowded space. The wedge is books that make reconciliation tools unnecessary, not a better reconciliation tool.
2. The 30-day IRN reporting window applies at 10 crore AATO, not 5 crore [16][17].
3. India's accounting software market is roughly USD 640 to 700 million (2024/25), not USD 3.4 billion. The larger figure traces to a press-release aggregator and could not be sourced [4].

## 3. Market and audience

| Figure                                    | Value                                                     | Source        |
| ----------------------------------------- | --------------------------------------------------------- | ------------- |
| India accounting software market, 2024/25 | ~USD 640 to 700M, ~9% CAGR to ~USD 1.4 to 1.5B by 2033/34 | IMARC [4]     |
| Tally installed base                      | 2M+ businesses, 80%+ share (secondary source)             | [1]           |
| Zoho finance suite India growth           | 50% YoY (Zoho's own release, Dec 2024)                    | [10]          |
| Account Aggregator ecosystem              | 17 licensed AAs, ~176 to 179 FIPs, ~950 to 1,076 FIUs     | Sahamati [21] |

**India is the right first market, for the compliance reason not the size reason.** The market is smaller than headlines say, but the compliance surface changes every 6 to 12 months, which punishes global vendors and rewards whoever owns the ledger and the filing state together [3]. A second market with a fresh e-invoicing mandate (for example UAE) is a plausible later expansion; this research did not go deep on it.

**Segments, ranked for the MVP:**

1. **CA-referred B2B SMBs, 2 to 50 crore turnover** (traders, distributors, agencies, service firms). Large enough to be above or near the 5 crore e-invoicing line, B2B-heavy so IMS and 2B matter monthly, already paying a CA, already on Tally. Pay 500 to 2,000 rupees per month per business today; will pay more to lose the second tool. This is the primary buyer.
2. **CA firms** (10K+ firms). The channel and a light co-buyer. Pain is deadline juggling, document chaos over WhatsApp and email, and per-client portal hopping. Willingness to pay of 5,000 to 15,000 rupees per month per firm is vendor-sourced and unverified [6]; validate with interviews.
3. **E-commerce sellers, 50 lakh to 10 crore.** Sharp pain (TCS at 0.5% since 10 July 2024 [7], dozens of settlement formats) but niche incumbents exist and marketplace APIs churn. An expansion module, not the wedge.
4. **Micro-traders under 50 lakh.** Largest headcount, near-zero willingness to pay, owned by Vyapar and myBillBook on price and offline use. Not for year one.

## 4. Competitor map

| Product                                      | Entry price                                              | Model                               | GST depth                                 | Multi-user cloud                | Exploitable weakness                                                                                          |
| -------------------------------------------- | -------------------------------------------------------- | ----------------------------------- | ----------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| TallyPrime                                   | ~26,550 rupees one-time + ~4,500/yr TSS [8]              | Perpetual desktop                   | Deep                                      | No (LAN)                        | No cloud collaboration, weak multi-branch, support via channel partners                                       |
| Zoho Books                                   | USD 0 to 275/mo, 6 tiers [9]                             | SaaS                                | Medium; first to add IMS [10]             | Yes                             | Workflow rigidity at scale, no phone support, compliance still shallower than Tally/Busy                      |
| Odoo Accounting                              | Free single app, then per-user [pricing unverified]      | SaaS                                | Medium via localization                   | Yes                             | Pricing confusion once a second app is added; e-invoice and e-way bill via generic localization               |
| SAP Business One                             | 8 to 50 lakh implementation + 15 to 22% maintenance [11] | License + services                  | Configurable                              | Yes                             | Overkill for SMBs; only relevant as the ceiling you upsell toward                                             |
| Frappe Books                                 | Free, MIT [12]                                           | OSS desktop (Vue, Electron, SQLite) | None                                      | No                              | No GST, IRN or e-way bill; single-user SQLite                                                                 |
| Vyapar / myBillBook                          | Free tier + paid                                         | Mobile app                          | Basic                                     | Vyapar single-device login [14] | Shallow reporting and CA collaboration; now buying compliance (Suvit) rather than building it into the ledger |
| ClearTax / Suvit (Vyapar TaxOne) / TaxSolver | Suvit from ~8,000 rupees/yr [25]                         | Compliance SaaS                     | Deep on filing and 2B                     | Yes                             | They sit beside the books, importing Tally backups; they cannot lock periods or own the source documents      |
| Xero / QuickBooks                            | USD 25 to 90/mo, unlimited users [13]                    | SaaS                                | None in India; QuickBooks exited 2023 [3] | Yes                             | UX and API benchmarks only                                                                                    |

## 5. Compliance the MVP cannot skip

| Rule                     | Threshold and date                                                                          | What the product must do                                                                           | Source        |
| ------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------- |
| E-invoicing (IRN)        | AATO above 5 crore; B2B, B2G, exports only                                                  | Generate IRN and QR through a GSP or the IRP API; show IRN state on the invoice                    | [15]          |
| 30-day IRN reporting cap | AATO 10 crore and above, since 1 April 2025                                                 | Block or warn before an invoice ages out; keep the guard generic since the threshold keeps falling | [16][17]      |
| Invoice series reset     | Every registered business, 1 April each year, reaffirmed FY2026-27                          | Automatic new series per financial year; reused numbers break GSTR-1                               | [18]          |
| IMS                      | Live since 1 Oct 2024; no action means deemed accepted                                      | Show the buyer-side accept, reject, pending queue inside the purchase register                     | [19]          |
| E-way bill               | Goods movement above 50,000 rupees; 180-day validity link to invoice; ship-to GSTIN capture | Generate and attach to the invoice; track expiry                                                   | [20]          |
| TCS on e-commerce        | 0.5% since 10 July 2024                                                                     | Only if serving marketplace sellers                                                                | [7]           |
| Bank data                | Account Aggregator framework, 17 AAs                                                        | Consented bank feeds through an AA technology provider; PDF statement import as year-one fallback  | [21]          |
| Record retention         | Not found in a primary source in this research                                              | Assume 6 to 8 years pending confirmation from a CA or the CGST Act text                            | open question |

## 6. Integrations and how to get them

- **GSTN APIs**: through a licensed GST Suvidha Provider (GSP) or an application service provider on top of one. Apply early; approval timeline is an open question.
- **Bank feeds**: Account Aggregator via a technology service provider, since direct AA integration requires FIU registration. Low adoption among traders today, so PDF import stays.
- **Payments**: Razorpay or Cashfree for UPI and card links with webhook posting to the ledger.
- **WhatsApp**: Meta Business API, one to two week approval. Sending invoices is table stakes; auto-posting UPI confirmations to the ledger is the differentiator nobody has [22 gaps].
- **Tally**: XML import and export from day one. Most prospects' history lives there [1]. Treat as onboarding, not a feature.

## 7. MVP scope

**Must have, so the target business never opens a second tool:** double-entry ledger; GST-correct invoicing (B2B and B2C, HSN and SAC, Tax Invoice versus Bill of Supply); credit and debit notes with tax reversal; IRN generation and state; e-way bill; purchase register with GSTR-2B pull, match, and the IMS queue; GSTR-1 and GSTR-3B as filing-ready views; period lock tied to filed returns; receipts and payments with bank statement import; P&L, balance sheet, trial balance, day book, ledgers in CA-ready export; CA membership across client organizations; immutable audit trail; Tally import.

**Deliberately excluded:** payroll and TDS returns; inventory valuation and manufacturing; marketplace settlement parsing; multi-currency; offline desktop mode; a customer portal; AI writing entries. Each of these is a real expansion but none is required for the "no second tool" promise to the chosen audience.

## 8. Core foundations to build first

1. **Document model with compliance state.** Invoice, credit note, debit note, purchase bill, payment and receipt are first-class records. Each carries a state machine for its own lifecycle (draft, finalized, cancelled) and for each compliance attachment (IRN, e-way bill, IMS, 2B match). Finalize assigns the number from the financial-year series and posts the ledger entries in one transaction.
2. **Immutable ledger.** Append-only journal lines. Corrections are reversing entries, never edits. This is what lets reports be trusted and what incumbent reconciliation tools cannot offer.
3. **Period close.** Lock postings per return period once GSTR-3B is filed; require a dated reversal in the open period. None of the reviewed products does this well.
4. **Versioned tax rules as data.** GST rates, HSN and SAC tables, thresholds and effective dates live in tables with validity ranges, never in code. Rules change every 6 to 12 months.
5. **Reports as views.** Trial balance, P&L, balance sheet, GSTR-1, GSTR-3B and the 2B match are all reproducible queries over the ledger and documents. Borrow the report template structure from Frappe Books, not its UI [12].
6. **Multi-organization membership.** One user is a member of many organizations with a union of roles; the CA workspace is a list of client organizations, not a separate product. The Better Auth organization plugin already models this.
7. **Integration ports.** One interface each for GSP, AA provider, payment gateway and WhatsApp so a provider swap is a config change.
8. **Audit trail.** Every sensitive mutation recorded with actor and time, fire-and-forget, never inside the domain transaction.
9. **Tally import.** Ledgers, parties, items and opening balances from Tally XML on day one.

**What to borrow from the references**

- **frappe/books** [12]: the double-entry core, report layouts and print formats. Avoid its desktop-only, single-user SQLite shape and its absence of any GST logic.
- **sfab-oss/sfab-starter** [26]: its document flow (draft, finalize with folio, activity log), its "agent over your own data" pattern with money mutations kept out of the agent, and its feature-key layering. Avoid Cloudflare D1 (SQLite) as the system of record for a ledger; Postgres with real transactions is non-negotiable here.
- **The current repository**: already has the multi-tenant spine, org-scoped procedures, ledger, GST outward register, audit and roles. Keep the spine and rebuild the domain around the document state machine above; drop the legacy OPD path once documents can be raised directly.

## 9. Beating incumbents over time

1. **Year one**: win CA-referred B2B SMBs with the no-second-tool promise. Moat: a business does not re-onboard its books twice.
2. **Year two**: turn CA firms into the channel with a firm-level view across client organizations (deadlines, unfiled periods, pending IMS actions). Moat: the CA's whole client base standardizes on you.
3. **Then**: add e-commerce settlement, payroll and TDS, inventory valuation. Moat: compliance breadth that QuickBooks could not sustain [3].
4. **Last**: fight for micro-traders, or do not. Tally and Vyapar own price and offline there.
5. **AI**: an agent that reads the ledger and answers "why is my ITC lower this month" is cheap to add on this foundation (sfab-starter shows the pattern) and hard for Tally to match. Keep it read-only over money until trust exists.

## 10. Open questions to validate before building

1. Do CAs want a shared live workspace with the client, or a CA-only tool that exports to the client's Tally? This changes the multi-organization design.
2. Is the CA willingness to pay real? The only figure found is from a vendor that sells reconciliation software [6].
3. GSP access terms and timeline for an unaffiliated startup.
4. Statutory record retention period for GST invoices and ledgers, from the CGST Act text, not blogs.
5. Will a 2 to 50 crore business leave Tally if its CA asks, and what does the migration need to look like?

## 11. Claim ledger

| Claim                                                     | Verdict            | Note                                                     |
| --------------------------------------------------------- | ------------------ | -------------------------------------------------------- |
| E-invoicing mandatory above 5 crore AATO, B2B/B2G/exports | Confirmed          | Since 1 Aug 2023, reaffirmed FY2026-27 [15]              |
| 30-day IRN cap applies above 5 crore from April 2025      | Refuted            | Applies at 10 crore and above [16][17]                   |
| IMS live 1 Oct 2024 with deemed acceptance                | Confirmed          | Usable from 14 Oct 2024 [19]                             |
| TCS cut from 1% to 0.5%                                   | Confirmed          | Effective 10 July 2024 [7]                               |
| Tally 80%+ share, 2M+ businesses                          | Confirmed          | Secondary sources only; 95% figures less sourced [1]     |
| India market USD 3.38B (2024) to 5.75B (2030)             | Refuted            | IMARC: ~USD 640 to 700M [4]                              |
| Zoho Books tiers USD 0 to 275/mo                          | Confirmed          | [9]                                                      |
| Xero unlimited users on every plan                        | Confirmed          | [13]                                                     |
| Invoice series reset every 1 April                        | Confirmed          | [18]                                                     |
| 17 AAs, ~176 FIPs, ~1,076 FIUs                            | Confirmed          | Counts drift; treat as approximate [21]                  |
| Frappe Books ~4.9k stars, no GST                          | Confirmed          | [12]                                                     |
| CA firms spend 60 to 90 hours/month on 2B reconciliation  | Unverified         | Vendor marketing only [6]                                |
| QuickBooks exited India                                   | Confirmed          | New finding; new subscriptions stopped 30 April 2023 [3] |
| No incumbent owns CA multi-client reconciliation          | Refuted (my check) | ClearTax, Suvit/Vyapar TaxOne, TaxSolver [23][24][25]    |

## 12. Sources

1. https://izoe.in/blog/why-is-tally-still-the-most-used-accounting-software-in-india/
2. https://www.aiaccountant.com/blog/best-ai-accounting-gst-tools-for-ca-firms-india/ (vendor-sourced)
3. https://blogs.intuit.com/2023/03/22/discontinuation-of-quickbooks-in-india/ ; https://inc42.com/buzz/intuits-shutting-down-quickbooks-offer-opportunities-to-startups-like-zoho/
4. https://www.imarcgroup.com/india-accounting-software-market
5. https://unibee.dev/blog/xero-vs-quickbooks-online-ultimate-comparison/
6. https://www.aiaccountant.com/blog/best-ai-accounting-gst-tools-for-ca-firms-india/
7. https://www.nyca.in/cbic-reduces-tcs-rate-from-1-to-0-5-for-e-commerce-operators-effective-july-10-2024/
8. https://www.tallyatcloud.com/article/tallyprime-pricing-in-india-2026-official-guide-for-businesses/876/0/1
9. https://www.capterra.com/p/163115/Zoho-Books/pricing/
10. https://prezohoweb.zoho.com/news/zoho-finance-and-operations-suite-grows-in-india.html
11. https://praxisinfosolutions.com/blog/sap-business-one-price-in-india-a-detailed-breakdown-of-sap-b1-cost/
12. https://github.com/frappe/books
13. https://www.erpresearch.com/pricing/xero
14. https://www.techjockey.com/reviews/vyapar
15. https://www.indiafilings.com/learn/mandatory-gst-e-invoicing-for-taxpayers-exceeds-threshold-limit-of-inr-5-crore
16. https://cleartax.in/s/time-limit-for-reporting-e-invoices-on-the-irp-portal
17. https://www.indiafilings.com/learn/gst-einvoice-30-day-rule-10crore-turnover
18. https://gstextract.com/blog/fresh-invoice-series-fy-2026-27
19. https://www.bssridhar.com/understanding-the-invoice-management-system-ims-in-gst-applicable-from-01-10-2024/
20. https://www.trulyinvoice.com/blog/e-way-bill-generation-rules-thresholds-distance-validity
21. https://sahamati.org.in/certified-entities-in-the-account-aggregator-ecosystem/
22. https://darwinbox.com/blog/10-best-payroll-software-india
23. https://www.suvit.io/ (Vyapar TaxOne, formerly Suvit)
24. https://cleartax.in/gst
25. https://www.suvit.io/pricing
26. https://github.com/sfab-oss/sfab-starter

## 13. Independent review findings

| #   | Sev  | Finding                                                                                                      | Change                                                                             |
| --- | ---- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 1   | High | TallyPrime 6.1 Connected GST does 2B, IMS, IRN, EWB and direct filing inside Tally [27]                      | Second-tool claim holds only for old Tally releases or no TSS                      |
| 2   | High | Zoho Books India: native IRP, 2B, IMS, filing as a GSP, INR 899 to 9,999/mo, transaction locking [28][29]    | Regrade Zoho as deep, cloud, multi-user; it is the cloud version of the proposal   |
| 3   | High | Busy and Marg missing; Busy ships e-invoice, 2B, TDS, 43B(h), inventory [30]                                 | Busy is the incumbent for distributors in the target segment                       |
| 4   | High | "No product does period close well" overstated; Tally cut-off date and return locking, Zoho transaction lock | Narrow to auto-lock on filed GSTR-3B with forced reversals; a feature, not a wedge |
| 5   | High | TDS deduction cannot be deferred for firms and companies; 194Q at 10 crore turnover [31]                     | Move TDS deduction to must-have                                                    |
| 6   | High | Traders need stock items, quantities and closing stock for a balance sheet                                   | Include basic stock; exclude only manufacturing                                    |
| 7   | High | CA channel contested and unpriced; Zoho gives CAs three years free, Tally has thousands of partners [29]     | State the CA offer; source the 20 to 50 client figure from interviews              |
| 8   | Med  | In-house accountant is the daily user in this segment, not the CA                                            | Add persona; Tally keystroke parity is a switching cost                            |
| 9   | Med  | IMS stale: Oct 2025 advisory adds pending for credit notes and partial reversal [32]                         | Update IMS state machine                                                           |
| 10  | Med  | MSME 43B(h) missing                                                                                          | Add to compliance and payables                                                     |
| 11  | Med  | Companies Act audit trail, India-server backup and 8-year retention missing                                  | Add; it is the best proof point for the immutable ledger                           |
| 12  | Med  | GSP is not an open question; IRP APIs free via sandbox, ASP registration free, usage-priced GSPs [33]        | Replace open question 3                                                            |
| 13  | Med  | Multi-currency exclusion conflicts with exporters in segment 1                                               | Include export invoices under LUT                                                  |
| 14  | Med  | Tally 80% share is reseller folklore                                                                         | State dominant, 2 to 3M paid users, share unsourced                                |
| 15  | Low  | Market size confirmed at USD 640M to 1.42B by 2033 [4]; compliance SaaS spend not counted                    | Add displaced compliance spend                                                     |
| 16  | Low  | E-invoicing 5 crore and 30-day cap at 10 crore confirmed on GSTN pages [34]                                  | Cite GSTN and CBIC over blogs                                                      |
| 17  | Low  | Unsourced: 10K+ CA firms, 500 to 2,000 rupees, Vyapar absorbing Suvit, QuickBooks exit as proof of moat      | Mark as estimates; soften the QuickBooks inference                                 |
| 18  | Low  | Sept 2025 GST rate rationalisation absent                                                                    | Cite as the case for versioned tax rules                                           |

Reviewer's verdict: the wedge as written does not survive. Reframe around ledger integrity for CA-managed multi-entity books, add TDS, MSME flags, basic stock and export invoices to the MVP, buy the CA channel with an explicit offer, and validate price against Zoho's INR list before building.

Additional sources from the review:

27. https://tallysolutions.com/gst/gst-invoice-reconciliation-tallyprime-ims/ ; https://help.tallysolutions.com/tally-prime/file-gst-returns/india-gst-filing-gstr1-tally/
28. https://www.zoho.com/in/books/help/gst/ims.html ; https://www.patronaccounting.com/blog/zoho-books-pricing-india-2026
29. https://www.zoho.com/in/books/CAday/ ; https://www.zoho.com/in/books/accountant/
30. https://busy.in/accounting-software/e-invoice/ ; https://busy.in/tds/section-43bh-msme-payment-rule-and-45-day-limit-explained/
31. https://www.incometaxindia.gov.in/w/tds-on-purchase-of-goods
32. https://www.caalley.com/gst25/gst-adv1017.pdf
33. https://einvoice6.gst.gov.in/content/e-invoice-apis-for-solution-providers/ ; https://taxpro.co.in/einvoice
34. https://einvoice6.gst.gov.in/content/revised-time-limit-for-e-invoice-reporting-for-businesses-with-aato-of-%E2%82%B910-crores-above/
