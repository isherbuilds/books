# Customer evidence

Researched 26 September 2026. This is the evidence base. The decisions that use
it are in [Launch and homepage](./launch-and-homepage-2026-09-26.md). It merges
five earlier notes from the same day; each source keeps its link, date and
limit.

## Question

Which accounting and billing problems do Indian owners, accountants and CAs
describe in public? Which remain unresolved, which were fixed, and what argues
against building another broad accounting product?

## Answer

The best-supported opportunity is to help an owner and accountant complete a
small set of everyday tasks: see what is paid and due, give the CA usable
records, and recover when an import or bank feed fails. The evidence does not
support a broad replacement for Tally, Zoho Books, Vyapar or myBillBook, and it
does not support a claim that incumbents ignore customers. Many old complaints
now have a fix, a workaround or a shipped feature.

## Method and limits

- **Sample.** About 36 public sources: 20 Reddit threads (four supplemental),
  nine Zoho Community threads, two Google Play listings (each holds several
  reviews) and five LinkedIn authors. The
  core window for social posts is September 2025 to September 2026; forum
  threads and a few Reddit threads are older and are dated. This is a purposive
  sample that searches for complaints. It overstates unhappy experience.
- **Reading.** Each core source was opened and read. Search snippets often
  showed the complaint and not the later answer, so no finding rests on a
  snippet.
- **Dates.** Reddit dates come from indexed content. LinkedIn dates come from
  `SocialMediaPosting.datePublished`. Forum dates come from the date elements'
  `title` attributes. First and last dates describe a discussion, not a
  continuous outage.
- **Identity.** Roles and outcomes are self-reported. No author was contacted,
  no group joined, no private ticket read and no paid competitor account tested.
- **Status words.** "Unresolved at report" means the author said so. "Unknown"
  means no outcome was visible. A vendor reply is a response, not a fix. Silence
  is not proof of neglect.
- **Coverage.** Searches of X, Facebook, Instagram and YouTube found no dated,
  readable firsthand source fit for the core set. Private Telegram, WhatsApp and
  Facebook groups were not read. That is an access limit, not proof that those
  places hold no complaints.

The sources do not establish prevalence, defect rates, market size,
willingness to pay, switching intent, current reproducibility or conversion
lift. No author is an Accly customer or endorser.

## Recurring problems

Strength: **strong** = explicit duration or repeated independent accounts;
**moderate** = one clear firsthand account; **weak** = promotional context,
old, or a single anecdote.

### Payment status and what remains due

| Source and date                                                                                                                                                                                                                                                        | Account                                                                                                                                                              | Status                                                                                        | Strength                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [Freelancer invoices](https://www.reddit.com/r/IndiaBusiness/comments/1vq1gdt/freelancers_what_do_you_use_for_invoices/), Reddit, 16 Aug 2026                                                                                                                          | Copies invoices in Docs; loses track of invoice numbers and whether a client paid.                                                                                   | Ongoing at report.                                                                            | Moderate; anonymous. Closest fit to a paid/due message.                                       |
| [Late agency payments](https://www.linkedin.com/posts/sidp88_ive-spent-the-last-year-back-in-the-agency-activity-7490774548745981952-Mo2J), LinkedIn, 5 Aug 2026                                                                                                       | Agency founder: 30-day terms become 45–90 days while staff costs are monthly.                                                                                        | Opinion post.                                                                                 | Weak; personal-brand post, not a tool evaluation. Supports visibility, not faster collection. |
| [Vyapar textile shop](https://www.reddit.com/r/Indianbusinesses/comments/1rti402/my_honest_experience_with_vyapar_app_for_my/), Reddit, 14 Mar 2026; [batch-transfer comment](https://www.reddit.com/r/Indianbusinesses/comments/1rti402/comment/p7yem95/), 5 Sep 2026 | The invoice message goes before cash can be recorded, so the buyer sees money due. Mouse-heavy counter billing. A second user cannot do size/batch godown transfers. | Transfer issue unresolved at comment; the same user says support fixed size tracking earlier. | Moderate; retail-specific. Payment state must be right before any reminder.                   |
| [Partial payments from Banking](https://help.zoho.com/portal/en/community/topic/apply-partial-payments-to-invoices-from-the-banking-module), Zoho forum, Apr–Dec 2025                                                                                                  | Extra steps to record a partial receipt from the Banking flow.                                                                                                       | Vendor acknowledged; offered other routes. September 2026 UI unverified.                      | Moderate. "Zoho cannot handle partial payments" is false.                                     |
| [Vyapar reviews](https://play.google.com/store/apps/details?id=in.android.vyapar&hl=en_IN), Google Play, 4–13 Sep 2026                                                                                                                                                 | Ayub S.K., three-year user: split-payment reports need manual fixes. Vaagai enterprises: stock/payment mismatch, slow support.                                       | Vendor says the feature exists; asks for contact.                                             | Weak–moderate. 403 helpful votes show salience, not reproductions. Listing rated 4.8.         |

### Owner–CA handoff and re-entry

| Source and date                                                                                                                                           | Account                                                                                                                                          | Status                                                  | Strength                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [Tally or cloud](https://www.reddit.com/r/IndianEntrepreneur/comments/1uma4ok/tally_vs_cloud_accounting_genuinely_confused_need/), Reddit, 3 Jul 2026     | Trader (₹30–40 lakh turnover) on Tally since 2019 travels two weeks a month; wants CA access without file sharing; worries about per-user price. | No switch reported.                                     | Moderate; use the OP only. Replies push Giddh heavily.                                                  |
| [CA rebuilds in Tally](https://www.reddit.com/r/IndiaTax/comments/18rxn3p/comment/kf4rc1a/), Reddit, Dec 2023                                             | Zoho works for the business; the CA re-enters it in Tally.                                                                                       | No change reported.                                     | Moderate; older.                                                                                        |
| [Auditor re-entry quote](https://help.zoho.com/portal/en/community/topic/zoho-books-and-tally-importation), Zoho forum, 2–5 Nov 2016                      | Indian auditor quotes ₹10,000 to re-key Books data into Tally.                                                                                   | Vendor suggested auditor access or exports; no closure. | Weak; old, single customer. Not one ten-year unresolved case.                                           |
| [Hardware business, two systems](https://www.reddit.com/r/IndiaTax/comments/1i1wn49/please_suggest_which_software_to_use_for_my/), Reddit, 15–16 Jan 2025 | Over ₹5 crore turnover; Tally for compliance, Zoho for invoices; wants sales-only staff access and less re-entry.                                | Unknown.                                                | Weak; poor stock records may be the cause. Some discussion covers off-book buying; do not build for it. |
| [Scattered practice records](https://www.linkedin.com/posts/harshiee_cms-portal-activity-7454039066649686017-c14o), LinkedIn, 26 Apr 2026                 | An accountant asks why client work sits in a dozen Excel sheets; built his own system.                                                           | Self-built.                                             | Weak; promotes his practice. CA credential unverified.                                                  |
| [Spreadsheet workflow](https://www.reddit.com/r/IndiaBusiness/comments/1ou23jd/which_accounting_software_do_you_use_for/), Reddit, 11 Nov 2025            | Invoices, bills and stock across spreadsheets become messy.                                                                                      | Unknown.                                                | Weak; commenters suspect promotion.                                                                     |

### Usable output, reliability and support

| Source and date                                                                                                                                                                                                                                                                                                                    | Account                                                                                                                                                           | Status                                                                  | Strength                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [myBillBook party-ledger export](https://www.reddit.com/r/IndiaBusiness/comments/1p9kp13/comment/nyqj8lx/), Reddit, 10 Jan 2026                                                                                                                                                                                                    | Paid user: the ledger export needs Excel repair; support asks for reviews.                                                                                        | **Unfixed for eight months** at report; current state unknown.          | Strong duration, one account. No file or ticket supplied.                                 |
| [myBillBook reviews](https://play.google.com/store/apps/details?id=com.valorem.flobooks&hl=en_IN), Google Play, 8 Jul–18 Sep 2026                                                                                                                                                                                                  | Manesh Kummar: billing failures return after backend fixes. Frostys: repeated reinstall and service calls. Ajmal Shah: extra scan charge after a yearly purchase. | Vendor replied to each; public outcome unknown.                         | Moderate. Listing rated 4.4. Price complaint is an allegation.                            |
| [myBillBook outage](https://www.reddit.com/r/LegalAdviceIndia/comments/18fltuc/how_to_file_complaint_against_product_company/), Reddit, 11 Dec 2023                                                                                                                                                                                | Cannot invoice after maintenance; support moves from 24 to 72 hours.                                                                                              | Short incident; outcome unknown.                                        | Weak; acute, not chronic.                                                                 |
| [Historical balance change](https://www.linkedin.com/posts/tushar-gupta-8b9471234_zohobooks-zoho-openletter-activity-7441114536184770561-w5vE), LinkedIn, 21 Mar 2026; [follow-up](https://www.linkedin.com/posts/tushar-gupta-8b9471234_zohobooks-accountingsoftware-dataintegrity-activity-7445110905232695296-m3Tl), 1 Apr 2026 | Alleges a retroactive change moved old balances; asks for bulk repair.                                                                                            | Unknown. One incident.                                                  | Weak; not reproduced. The follow-up's "20 days" conflicts with the dates and is excluded. |
| [Monthly P&L comparison](https://help.zoho.com/portal/en/community/topic/unable-to-produce-monthly-p-l-reports-for-previous-years), Zoho forum, 6 Aug 2020–25 Mar 2026                                                                                                                                                             | Cannot produce prior-year monthly P&L without spreadsheet work.                                                                                                   | Marked solved: use Previous Month, not Previous Period. Not reproduced. | Moderate. The gap is discoverability, not a missing report.                               |

### Bank feeds and statement import

| Source and date                                                                                                                                                                                           | Account                                                                    | Status                                                     | Strength                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| [HDFC feed escalation](https://www.linkedin.com/posts/chandanmunshi_i-rarely-post-public-escalations-but-this-activity-7418915033180721152-aGka), LinkedIn, 19 Jan 2026                                   | HDFC feed broken since 19 December; a month of repetitive support replies. | Unresolved at report.                                      | Moderate; cause unverified.                                  |
| [Axis/SBI feeds](https://help.zoho.com/portal/en/community/topic/bank-account-sync), Zoho forum, 4 Mar 2017–20 Sep 2019                                                                                   | Stale Axis transactions for four days; SBI missing a week in 2019.         | Axis fix confirmed by the author; SBI fix vendor-reported. | Moderate; repeated category, separate incidents.             |
| [ICICI duplicates after upgrade](https://help.zoho.com/portal/en/community/topic/icici-integration-migration), Zoho forum, 11–13 Oct 2018                                                                 | Duplicate statement lines after an overlapping fetch date.                 | Workaround: exclude duplicates.                            | Weak; supports safe replay and overlap preview.              |
| [ICICI onboarding paused](https://help.zoho.com/portal/en/community/topic/icici-integration), Zoho forum, 21 Oct–2 Nov 2024                                                                               | New ICICI onboarding paused; manual uploads painful.                       | Vendor explained; current docs offer setup.                | Weak; third-party dependency.                                |
| [Statement import](https://help.zoho.com/portal/en/community/topic/import-of-bank-statement-do-not-work-date-mapping-issue-basic-feature-issue-becoming-serious-pain), Zoho forum, 3 Sep 2021–29 Mar 2025 | Date-mapping errors; in 2025 an HDFC PDF import pending five days.         | Marked solved; provider fix vendor-reported.               | Moderate; recurring category, not one four-year defect.      |
| [Searching matched statements](https://help.zoho.com/portal/en/community/topic/search-matched-or-categorized-bank-statements), Zoho forum, 20–24 Jan 2023                                                 | Cannot find matched statement text.                                        | Explained; labelled Implemented.                           | False positive for an unmet need.                            |
| [IDFC bank transactions](https://www.reddit.com/r/StartUpIndia/comments/1wqjiqb/how_to_fetch_bank_transactions_and_statement/), Reddit, 26 Sep 2026                                                       | Repeated OTP/login work; the desired Zoho connection is unavailable.       | New; no outcome.                                           | Weak; supplemental.                                          |
| [US Zoho customer](https://www.reddit.com/r/smallbusiness/comments/1hcxoxs/seeking_viable_alternative_to_zoho_books/), Reddit, 12 Dec 2024                                                                | Feeds stopped six times in 2024; nine open issues.                         | Unknown.                                                   | Supplemental; US only. Hostile nationality remarks excluded. |

### Vertical fit and price

| Source and date                                                                                                                                              | Account                                                                                | Status                                                                                         | Strength                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [Customer hierarchy](https://help.zoho.com/portal/en-gb/community/topic/customer-parent-account-or-sub-customer-account), Zoho forum, 8 Dec 2020–24 May 2026 | One head-office payment across branch invoices. 86 replies, 77 votes.                  | Hierarchy shipped; CRM sync and plan access still criticised; Feb 2026 staff give no timeline. | Moderate; partly addressed. Costly first-release scope.                  |
| [Vyapar kidswear owner](https://www.reddit.com/r/Bookkeeping/comments/jndlbn/comment/mj92rk2/), Reddit, 23 Mar 2025                                          | Three years on Vyapar for ledgers only; needs barcode, dead-stock and incentive tools. | Unknown.                                                                                       | Weak; retail scope. Three years of use is not three years of one defect. |
| [Pharmacy staff permissions](https://www.reddit.com/r/IndiaBusiness/comments/1tz7xd2/need_advice_on_billing_and_inventory_management/), Reddit, 7 Jun 2026   | Hospital co-owner cannot find a way to let staff bill without stock admin.             | OP allows it may be a discovery problem.                                                       | Weak; two answers come from software builders.                           |
| [Pharmacy reports](https://www.reddit.com/r/india/comments/oz37fw/any_pharmacist_that_uses_mybillbook_vyaapar_app/), Reddit, 6 Aug 2021                      | Cannot find medicine-class reports in myBillBook.                                      | No replies.                                                                                    | Weak; supplemental, old.                                                 |
| [Price-sensitive shop](https://www.reddit.com/r/TamilNadu/comments/1euz6vk/need_invoicing_software/), Reddit, 18 Aug 2024                                    | Wants under ₹4,000/year; Zoho Zakya too expensive; Vyapar sync issues.                 | Trying myBillBook.                                                                             | Moderate for a low-budget segment; prices are historical.                |

## Counterevidence

- **Bank feeds can work.** A corporate HSBC user relies on Zoho at 30–40
  outgoing payments a day; another reports good SBI use
  ([Reddit, 23 Jun 2026](https://www.reddit.com/r/Zoho/comments/1ud4kiz/which_indian_bank_works_best_with_zoho_books_in/)).
  The same thread's HSBC-withdrawal rumour is unverified.
- **Migration can succeed.** Users report exact reconciliation of seven years
  of Xero data and a hard but worthwhile QBO move
  ([Reddit, Mar 2026](https://www.reddit.com/r/Zoho/comments/1s24es8/migration_to_zoho_books/)).
  These are not Tally moves. The top answer sells migration services.
- **Some complaints are configuration.** An accountancy firm solved a client's
  recurring-billing problem by turning off quote-to-draft automation
  ([LinkedIn, 17 Mar 2026](https://www.linkedin.com/posts/ultra-accountancy-limited_zohobooks-accountant-howto-activity-7439570471903420416-AYvP)).
  It is a promotional post, but it gives a concrete fix.
- **Support sometimes fixes the incident.** See the Axis feed thread above.
- **Cheap products can be enough.** A myBillBook user pays ₹499/year and says
  it meets most needs
  ([Reddit, 12 Jul 2026](https://www.reddit.com/r/MicroBusinessIndia/comments/1uuqo7n/comment/ox5i6q5/)).
  The Play listings rate 4.4 and 4.8, and one Vyapar reviewer praises support.
- **Tally keeps its users for real reasons.** Users value keyboard speed and
  the supply of trained staff
  ([Reddit, Dec 2023](https://www.reddit.com/r/IndiaTax/comments/18rxn3p/is_there_a_reason_most_businesses_use_tally/)).
  In a [2 Aug 2026 thread](https://www.reddit.com/r/CharteredAccountants/comments/1vd8ghm/why_is_tally_still_king_in_india_why_are_people/),
  one respondent says [accountants who know Tally are easy to hire](https://www.reddit.com/r/CharteredAccountants/comments/1vd8ghm/comment/p17blen/);
  [another raises migration and training cost](https://www.reddit.com/r/CharteredAccountants/comments/1vd8ghm/comment/p17divz/).
  The OP is building a cloud product; only the replies count.
- **Incumbent ecosystems satisfy some users.** A metal-business operator values
  Zoho Commerce and Books inventory integration
  ([Reddit, 20 Sep 2026](https://www.reddit.com/r/IndiaBusiness/comments/1wklcnb/comment/pax300g/)).

A new product must pay for migration, retraining and trust. "Modern UI",
"cloud", "CA access" and "cheaper" alone are weak reasons to switch.

## Competitor and compliance facts

Official pages own these claims. Offered capability does not prove reliability
or satisfaction.

- Zoho Books India already has
  [comparative and saved reports](https://www.zoho.com/in/books/help/reports/business-overview.html),
  [bank feeds with 24-hour fetch and provider dependency](https://www.zoho.com/in/books/help/banking/feeds.html),
  [PDF statement import via Perfios with preview and undo](https://www.zoho.com/in/books/help/banking/add-transactions.html)
  ([allow 48 hours before escalating](https://www.zoho.com/in/books/kb/banking/unable-to-import-statements.html)),
  [ICICI setup](https://www.zoho.com/in/books/help/online-payments/icicibank-integration.html),
  [five-level customer hierarchy](https://www.zoho.com/in/books/help/contacts/customer-hierarchy.html),
  [installment matching](https://www.zoho.com/in/books/accounting-software/bank-reconciliation/),
  [bank-transaction search in its API](https://www.zoho.com/books/api/v3/bank-transactions/),
  [migration help through support and partners](https://www.zoho.com/in/books/),
  [invoices, banking and inventory connections](https://www.zoho.com/in/books/accounting-software-features/),
  an [organization-scoped API](https://www.zoho.com/books/api/v3/introduction/)
  and [recurring invoices](https://www.zoho.com/in/books/help/recurring-invoice/).
- [Zoho India pricing](https://www.zoho.com/in/books/pricing/) lists accountant
  access and period locks. Annual billing is ₹749/month per organization
  (Standard) and ₹1,499 (Professional).
- Zoho's [property management product](https://www.zoho.com/creator/property-management-system/)
  covers units, leases, rent and maintenance, which accounting alone does not.
- Tally documents [GSTR-2B reconciliation](https://help.tallysolutions.com/gstr-2b-reconciliation/).
- The [GST portal FAQ](https://tutorial.gst.gov.in/userguide/returns/FAQ_gstr2b.htm)
  says some credit conditions are not in GSTR-2B and need self-assessment. No
  tool can guarantee that input credit is never lost.
- E-invoicing covers businesses above ₹5 crore from August 2023
  ([Lok Sabha answer](https://sansad.in/getFile/loksabhaquestions/annex/1712/AU678.pdf?source=pqals));
  applicability depends on the taxpayer and transaction.
- Personal tax uses a separate source-record and return workflow
  ([salaried individuals](https://www.incometax.gov.in/iec/foportal/help/individual/return-applicable-1),
  [ITR-1](https://www.incometax.gov.in/iec/foportal/help/how-to-file-itr1-form-sahaj)).

## Colour and accessibility

These are older foundational sources, not customer evidence. None shows that
monochrome, blue, teal or lavender converts better for Indian accounting
software.

- Elliot, [_Color and psychological functioning_](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2015.00368/full)
  (2015): colour effects depend on context; the research has method limits.
- Nielsen Norman Group, [similarity principle](https://www.nngroup.com/articles/gestalt-similarity/)
  (2020): a consistent treatment groups related elements, so one filled button
  style can mark the main action.
- W3C [use of colour](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)
  and [contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html):
  colour is never the only signal; normal text needs 4.5:1.
- W3C [older users](https://www.w3.org/WAI/older-users/): accessibility
  standards cover most older-user needs. No source gives the age profile of
  Indian accounting buyers.
- A [2013 display-polarity study](https://pubmed.ncbi.nlm.nih.gov/23654206/)
  found dark text on light backgrounds improved acuity for both age groups
  tested (abstract only). A [2024 chart study](https://arxiv.org/html/2409.10841v2)
  found no consistent age-based light/dark winner (US sample).

## Excluded sources

- A [YouTube "2026" review](https://www.youtube.com/watch?v=fSyVBH3otK0),
  published 27 March 2025 with an affiliate disclosure.
- Undated Zoho forum posts on
  [keyboard navigation](https://help.zoho.com/portal/en/community/topic/system-wide-keyboard-navigation-problem-with-searchable-dropdown-fields),
  [ledger descriptions](https://help.zoho.com/portal/en/community/topic/detailed-general-ledger-display-transaction-description-in-reports)
  and [export format](https://help.zoho.com/portal/en/community/topic/format-of-data-after-export-to-spreadsheet).
- A [founder replacing Zoho](https://www.linkedin.com/posts/activity-7490933306327457793-MojQ)
  (6 Aug 2026): outside India, weeks of use, promotes his own build.
- A [Telegram Tally tutorial](https://t.me/s/technical_glamour?before=86): old
  version, author-solved.
- A [Kerala GST thread](https://www.reddit.com/r/Kerala/comments/1mktj5p/)
  (8 Aug 2025): returned an error twice.
- Repeated Vyapar endorsements from [one user history](https://uk.reddit.com/user/Vedu1679),
  repeated Giddh replies, and founder "now I am building" posts: not
  independent counts.
- Zoho's [Tally migration guide](https://www.zoho.com/books/help/migration/tally-to-zoho-books.html)
  applies to GCC editions, not India. The Play app `com.vyapar.app` is a
  grocery app, not Vyapar accounting.
- Contested vendor incidents are never used as attack copy.
