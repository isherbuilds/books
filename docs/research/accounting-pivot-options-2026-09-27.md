# Accounting product pivot options

Researched 27 September 2026. This expands the [earlier first-offer review](./accounting-offer-market-2026-09-27.md). It replaces that note's narrow recommendation for a CA-approved accounting pilot as the **default first bet**. No buyer interview or payment has validated any option below. This is a choice of what to test, not approval to change the product or public site.

## Question

If the product, customer, features, and landing page can change, what problem offers the best first commercial wedge?

## Answer

**Test an invoice-acceptance and payment-predictability workflow for Indian B2B service suppliers that sell to larger buyers on purchase orders or monthly approvals.** Keep Tally or Zoho as the accounting system during the first test. The buyer is the supplier's owner or finance lead. The product helps them make each invoice complete, get an acknowledgement, log a reason when the buyer blocks it, and track a named payment commitment. This is an inference from documented payment frictions, not evidence that this particular product will sell. [Dun & Bradstreet, GAME and Omidyar Network India delayed-payments report, 2022](https://www.dnb.co.in/file/reports/Delayed-Payments-Report.pdf).

Why this ranks first: a buyer can judge the result on a real invoice in weeks, and a manual service can test it before building an integration. The core accounting app already models invoices, receipts, allocations, parties and supporting files, though it would need new acceptance, evidence, follow-up and import workflows. [Product scope](../product.md#scope); [accounting core](../specs/accounting-core.md). It does **not** follow that a better reminder tool will win: [Zoho Books](https://www.zoho.com/in/books/help/customer-portal/) has a customer portal, partial payments and comments; [TallyPrime](https://tallysolutions.com/business-guides/how-to-track-receivables-aging-and-send-payment-reminders-in-tallyprime/) documents receivables ageing and reminders; [Credflow](https://credfloat.in/pricing) sells Tally/Busy-connected reminders and a collection CRM. The wedge is the work **before** a valid invoice is accepted and the evidence behind a specific payment commitment. That gap remains to be tested with users.

## Evidence and its limits

- The 2022 [delayed-payments study](https://www.dnb.co.in/file/reports/Delayed-Payments-Report.pdf) estimates ₹10.7 lakh crore locked in delayed MSME payments. It reports that suppliers in its interviews often valued predictability over strict adherence to a short payment term. This is strong evidence of a broad economic problem, but it is dated, and it does not prove software willingness to pay.
- The same study's analysis of MCA buyer-reported reasons includes late invoice submission, quality disputes, reconciliation, incomplete GST compliance, and unknown MSME status. It explicitly says hard empirical evidence for some assumed supplier invoicing failures is absent. These categories justify asking about invoice acceptance; they do not show which cause a new product can change. [Study, causes of delay](https://www.dnb.co.in/file/reports/Delayed-Payments-Report.pdf).
- [Zoho Books India pricing](https://www.zoho.com/in/books/pricing/) lists a free plan with invoicing, reminders, bank reconciliation, GST reporting and one accountant. Standard is listed at ₹749 per organization per month when billed annually, excluding local taxes. A generic replacement ledger needs a very strong switch reason.
- [TallyPrime](https://help.tallysolutions.com/gstr-2b-reconciliation/) already reconciles GSTR-2B, and its [connected banking](https://tallysolutions.com/features/banking/) covers bank data and payment links. A GST or banking feature list alone is weak differentiation.
- [Credflow](https://credfloat.in/pricing) lists annual plans from ₹4,999 to ₹19,999 with reminders, Tally/Busy access and collection features. Its list price is a competitive anchor, not a measure of conversion or customer satisfaction.
- [Practivo](https://practivo.in/) sells document requests and uploads to CA firms. [AuditAudire](https://www.auditaudire.com/) sells Tally-based review, reconciliation and exception closure. [Zoho Books](https://www.zoho.com/in/books/help/accountant/manage-clients.html) has an accountant client view. A generic CA portal is also contested.
- The repository's [HMS report investigation](/Users/docbook/accly-ai/hms/docs/research/hospital-wide-financial-reports.md) identifies a concrete accountant handoff: several billing streams need one explainable invoice register and collections register. This is product-fit evidence inside the founder's related work, not independent hospital demand or payment intent.

## Four product directions

| Direction                                      | Buyer and first outcome                                                                                                                    | Advantage                                                                                                                | Hard part                                                                                                                                                     | Rank                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Invoice acceptance and payment commitments** | Supplier owner or finance lead: each monthly invoice has required documents, buyer acknowledgement, blocker, and expected payment date.    | Test with a manual 30-day sprint; keeps existing books. The delayed-payment study names several causes beyond reminders. | Enterprise buyer processes differ; Credflow and others cover adjacent collections.                                                                            | **Test first.**                                                             |
| Hospital billing-to-books bridge               | Hospital operator and CA: one source-linked register across OPD, pharmacy and other streams, with matched collections and a clean handoff. | Related HMS work provides a real integration surface and a known reporting question.                                     | Need a named hospital buyer, exact accounting acceptance, tax classification and support owner. May start as an HMS feature rather than a standalone company. | Test in parallel only if the founder has direct buyer access.               |
| CA exception workspace over Tally              | CA partner: import client books, find exceptions, get answers, close a month with an evidence trail.                                       | Firms already buy software and can bring multiple clients.                                                               | Existing CA practice, GST and audit products cover much of this; data access and exact workflow are harder.                                                   | Second bet if five firms show a repeated unserved task and pay for a pilot. |
| Full replacement accounting                    | Owner: one shared system for bookkeeping, billing, GST and CA review.                                                                      | Reuses most current implementation.                                                                                      | High migration and trust cost; Zoho and Tally are broad, inexpensive incumbents.                                                                              | Keep available, but do not make it the only commercial bet.                 |

These ranks are judgments about **speed to a credible buying test**, not market-size scores. The same study and competitor pages cannot establish the conversion rate of any offer. [Product position](../product.md#position); [delayed-payments study](https://www.dnb.co.in/file/reports/Delayed-Payments-Report.pdf).

## First niche and offer to test

**Recruiting filter:** Indian B2B service suppliers with monthly invoices to larger companies, a PO or approval step, and an owner or finance lead who can show three delayed invoices. Staffing, facilities, IT services and agencies are recruiting hypotheses; do not choose a vertical from a keyword or one anecdote. The actual qualifier is a repeatable gap between work done, invoice accepted and cash received. The delayed-payments study supports the process question, not a specific vertical winner. [Study](https://www.dnb.co.in/file/reports/Delayed-Payments-Report.pdf).

**Working offer:** "For 30 days, we track your next monthly invoices from evidence pack to buyer acknowledgement and promised payment date. We surface blocked invoices while there is still time to fix them. Your accountant keeps the existing books."

**Proposed delivery, tested manually first:**

1. Read three recent invoice chains with permission: contract or PO, work acceptance, invoice, submission channel, buyer reply, follow-up and bank receipt. Record exact dates and reason for each wait. Do not copy customer data until a safe handling agreement exists.
2. Create a buyer-specific submission checklist and one status per invoice: work approved, ready to submit, submitted, acknowledged, disputed, approved for payment, promised date, partly paid, paid. Record who asserted each status and its evidence. A sent email alone does not prove buyer acceptance.
3. Run a weekly exception review with the supplier. Name the next action and owner. Notify the right human of missing documents or missed commitments. Record partial payments and TDS separately so "paid" is never guessed from a message.
4. Reconcile the final invoice and receipt state to the existing books. The accounting app could later become the source of books, but that is a separate buyer decision.

The first software slice, if a paid manual pilot works, is invoice intake plus document checklist, evidence and status timeline, owner queue, and CSV export/import with Tally or Zoho. Automated WhatsApp, direct bank feeds, GST filing, AI collection agents, and Tally sync should follow an observed workflow and a real integration owner. Existing app scope and extension rules are in [Product](../product.md#scope).

**Price experiment:** Quote a paid 30-day service pilot at a fixed price to each qualified buyer. A starting test could be ₹9,999 for up to 20 invoice chains, with a later software-plus-review subscription quoted only after support time and outcomes are measured. This number is an experiment, not a market-derived price. Compare what the buyer pays today to resolve blocked invoices, and ask for payment before building the full product. Credflow's published [annual plans](https://credfloat.in/pricing) make a generic reminder-only offer at this price hard to justify.

**Risk promise:** "If we cannot show which invoices were accepted, blocked, or awaiting a buyer response by the end of the sprint, we will return the pilot fee." This is a proposed narrow guarantee for a manual service, subject to defining buyer cooperation and data access in writing. Do not promise earlier payment; buyer cash release is outside our control. The [2022 study](https://www.dnb.co.in/file/reports/Delayed-Payments-Report.pdf) documents buyer-side funding and power imbalances as causes that supplier software cannot remove.

## Marketing script and landing-page direction

The buyer is a supplier owner or finance lead, reached through direct introductions, industry associations or accountants who know suppliers with unresolved enterprise invoices. The first call is a diagnosis, not a feature demo. [Core Four skill](https://github.com/zacker-tech/hormozi-skills/blob/main/skills/core-four/SKILL.md); [market-research skill](https://github.com/alexsmedile/hormozi-skills/blob/main/skills/market-research/SKILL.md).

**First message draft:** "I am studying why completed B2B work waits between invoice submission and buyer payment. If you had an invoice delayed last month, could you show me the PO, submission date and buyer response with names hidden? I will map where it stalled and send the timeline back."

**Landing-page hypothesis, after a paid pilot:**

- Headline: **"Know why each invoice is waiting."**
- Support: "Keep the PO, work proof, buyer acknowledgement and payment promise beside each invoice. See missing steps before they delay this month's cash. Keep Tally or Zoho for your books."
- CTA: "Review three delayed invoices."
- Proof section: one permitted, anonymized invoice timeline with its actual dates and a specific corrected blocker. Do not claim money recovered or days saved until measured.

The current public site was selected for a different product story and includes unverified claims; a pivot would need a new approved message and feature scope. This note does not change it. [Launch note](./launch-and-homepage-2026-09-26.md#decisions); [current homepage](../../apps/web/src/routes/_site/index.tsx).

## Validation plan and stopping rules

1. Interview 12 qualified supplier owners or finance leads, not general SMBs. Ask for the last three delayed invoice chains. Code the cause of each delay and whether a supplier-side action could have changed it. Ask what system they already use and who owns follow-up.
2. Run at most three manual 30-day pilots. Ask for the fixed pilot fee before custom software work. Track accepted invoices, unresolved blockers, promised-payment accuracy, supplier hours, founder hours, and cash dates. Do not attribute a paid invoice to the service without a credible counterfactual.
3. Continue this pivot only if at least two buyers pay, show repeated supplier-fixable blockers, and ask to continue after the sprint. If most delays are buyer cash shortages or internal payment policy, the proposed software cannot solve the core cause; stop or change buyer and problem. If Credflow or an incumbent already handles the full workflow well, do not clone it.
4. If the founder can reach a hospital decision maker sooner, run a separate paid handoff test using one month of HMS invoices and collections. Do not build a full hospital ledger before the CA signs off on the exact export and the hospital commits to pay. [HMS investigation](/Users/docbook/accly-ai/hms/docs/research/hospital-wide-financial-reports.md).

## What this proves and does not prove

The evidence establishes delayed payments as a material Indian MSME problem, names several administrative causes, and shows strong incumbent coverage of general accounting, reminders, GST and CA tools. It does not establish that invoice acceptance is under-served for the proposed buyers, that they will pay this team, or that the existing app should be rewritten. A dated paid pilot is the next evidence gate. [Delayed-payments study](https://www.dnb.co.in/file/reports/Delayed-Payments-Report.pdf); [Zoho pricing](https://www.zoho.com/in/books/pricing/); [Credflow pricing](https://credfloat.in/pricing).
