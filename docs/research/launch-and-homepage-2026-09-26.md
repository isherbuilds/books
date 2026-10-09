# Launch and homepage

Researched 26 September 2026. These are recommendations, not approved scope.
The evidence is in [Customer evidence](./customer-evidence-2026-09-26.md).
[Product](../product.md) owns scope and [Design](../design.md#public-site)
owns the shipped homepage. No prospect was contacted. This note merges six
earlier notes; where they disagree, it records each position as an open
decision.

## Decisions

The owner decided on 26 September 2026:

- The public site uses **Edernal Books**. The app keeps "Accly Books" until a separate rename.
- The public site follows the Claude design artifact: its copy, headline, lavender
  "stamp" palette, prices and sub-pages. The site stays private until the product
  catches up, so the claim conflicts below are accepted for now. Close each one
  before public launch.
- No language switch. Hindi is out of scope for now.
- More motion and more pages are welcome on the public site; the console keeps its
  motion rules.

The table below keeps the earlier positions for the record. The first cohort is still
open. The source notes are named by their former filenames; they are merged here and
deleted.

| Decision           | Positions                                                                                                                                                                                         | Where each came from                                                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product name       | **Accly Books**: shipped in `apps/web/src/config/site.ts`; "retain Accly Books". **Edernal Books**: used for the launch review and the evidence registers.                                        | Accly: `marketing-home.md`, `customer-needs-2026.md`, `market-audience-and-palette-2026-09-26.md`. Edernal: `edernal-*-2026-09-26.md`, the Claude design artifact.                                                                                        |
| Headline           | **"Know what's paid. See what's due."** (shipped). **"Your business and your CA. One set of books."** **"Get paid sooner"** / "Getting paid and never losing input credit" (the artifact's hero). | Shipped line: `marketing-home.md`, `customer-needs-2026.md`, `edernal-launch-review-2026-09-26.md`, `edernal-evidence-forums-2026-09-26.md`. CA line: `market-audience-and-palette-2026-09-26.md`. Paid-sooner: the Claude artifact.                      |
| Palette            | **Monochrome**: charcoal `#202020`, white `#fcfcfc`, greys (shipped). **Neutral with restrained blue**: action `#2457A7`. **Lavender accent** `#ceb4f4` and a "stamp" on a dark hero.             | Monochrome: `marketing-home.md`, `customer-needs-2026.md`, Design. Blue: `market-audience-and-palette-2026-09-26.md`, written after the founder's monochrome preference was withdrawn. Lavender: the Claude artifact and the prototype's Focus direction. |
| Design exploration | Stopped; research only; no visual direction recommended. Now under consideration: the Claude artifact.                                                                                            | Stopped: `edernal-deep-research-2026-09-26.md`. Reopened: the owner, 26 September.                                                                                                                                                                        |
| First cohort       | Owner-run **service or rental businesses** with one to three entities and an external CA. The pasted plan's **₹1–50 crore** businesses, including distributors.                                   | Service: `market-audience-and-palette-2026-09-26.md`, `edernal-launch-review-2026-09-26.md`, `edernal-deep-research-2026-09-26.md`. Broad band: the supplied launch plan.                                                                                 |
| Price              | **No public price** during the pilot (shipped FAQ). A ₹7,499 founding price and ₹14,999 list price; the plan both hides and publishes prices.                                                     | FAQ: `apps/web/src/content/faqs.ts`. Prices: the supplied launch plan, reviewed in `edernal-launch-review-2026-09-26.md`.                                                                                                                                 |

No source shows that any headline or colour converts better. Choose by
owner preference and test; do not cite colour psychology as the reason.

## The Claude design artifact

A later Claude design artifact is under consideration: a landing page with
Edernal branding, a lavender "stamp" accent, prices and feature claims. The
launch review saw its hero only
([artifact](https://claude.ai/artifact/7QRFi3RMq9k8BjTsu2xNJM); security
verification blocked the rest). This note did not read the later version.
The shipped FAQ (`apps/web/src/content/faqs.ts`) contradicts these claims:

| Artifact claim                                          | Shipped FAQ or evidence                                                                                                                                         |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bank matching, "all your bank data"                     | "Bank feeds, automatic bank reconciliation and payment collection are not supported in the pilot."                                                              |
| GSTR-2B matching, "never losing input credit"           | FAQ lists GST registers only; "Return filing and e-invoicing are not supported." The GST portal says credit needs self-assessment, so no tool can guarantee it. |
| E-invoice IRN                                           | "Accly Books does not generate IRNs or submit invoices to the Invoice Registration Portal."                                                                     |
| Offline use                                             | "Offline entry is not built."                                                                                                                                   |
| Tally import done for you, "free Tally switch"          | "There is no automatic Tally or Zoho history import." The pilot starts from masters and opening balances.                                                       |
| Published prices, first-50 offer, two-year lock, refund | "There is no public price list while the pilot runs."                                                                                                           |
| "Paid in 12 minutes", UPI chat beside Paid              | No payment collection. A shared message does not prove the receipt was recorded.                                                                                |
| Five-minute replies                                     | No staffed support promise exists.                                                                                                                              |
| EN / हिं switch                                          | The app has no Hindi interface.                                                                                                                                 |

Either the product ships the feature first, or the page drops the claim.

## First customer

Test **standalone accounting for owner-run Indian service businesses that
invoice regularly and work with an external CA**: little or no stock, a
document volume one person can manage, and a shown problem tracking payments
or preparing records for the CA. Agencies, consultancies and local B2B
service firms are recruitment examples. This fits current scope; it is not
proven demand.

Reasons:

- Product fit. [Product](../product.md) says external demand is unproved.
  [Accounting core](../specs/accounting-core.md) keeps hospital and school
  operations outside Books. The `tenant` party role
  ([parties.ts](../../packages/db/src/schema/parties.ts)) is a counterparty,
  not leases or rent schedules. Document sources are `user` and `opening`
  ([documents.ts](../../packages/db/src/schema/documents.ts)); there is no
  public integration interface.
- Retail and distributors need stock, batches, variants, godowns, printers and
  keyboard speed. Inventory is deferred, so they are a poor first fit.
- Businesses above ₹5 crore may need e-invoicing, which is not built. Prove a
  compliant process or exclude them from the first cohort.

Roles to test: the **owner buys**, an **owner or bookkeeper operates**, the
**CA reviews and may veto** a switch. The `ca` role can review, export and set
locks, but cannot post. Discovery must test whether that split matches
practice. Age is a sampling dimension, not a target.

Other candidates:

| Candidate                     | Recommendation                                                                                                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Founder's rental business     | Operating pilot. Compare with independent rental owners before choosing rentals. Property rental needs dues by tenant and period, deposits and maintenance; equipment rental needs bookings and returns. The rental type is still unknown.                                     |
| Hospitals and schools         | One partner-led integration at a time, with a named partner, sample records, volume and a support owner. The [hospital report investigation](/Users/docbook/accly-ai/hms/docs/research/hospital-wide-financial-reports.md) shows a handoff need; a better export may solve it. |
| Stock-heavy POS and ecommerce | Defer.                                                                                                                                                                                                                                                                         |
| Salaried personal tax         | Separate future product decision.                                                                                                                                                                                                                                              |

## Launch plan

Keep:

- An assisted pilot, reports and import first, CA-led discovery, and AI drafts
  that a person reviews.
- Per-owner pricing, the [product direction](../product.md#position).

Change:

- **Build inventory.** Customer TDS on receipts is implemented
  ([receipt.ts](../../packages/api/src/routers/receipt.ts#L73),
  [posting.ts](../../packages/api/src/core/posting.ts#L205),
  [receipt.test.ts](../../tests/integration/receipt.test.ts#L335)); its
  runtime and CA acceptance are pending. The plan omits slice 9, party Journal
  settlement; review its need for the pilot.
- **April 2027 is a target window**, not a gate. Interview firms now; start
  pilots when the workflow passes acceptance. Separate founder trials, invited
  pilots and open launch.
- **The moat is a hypothesis.** Tally has 2B reconciliation; Zoho has
  accountant access and locks. Test whether one owner–accountant–CA workflow
  removes re-entry: a named CA saves time on one client, repeats it, and
  introduces a paying client. "One CA brings 15–40 businesses" is a forecast.
- **Price the service.** Define one owner subscription: entities, users and
  migration scope. It must not imply consolidated reports. Three Zoho
  organizations cost ₹26,964 or ₹53,964 a year. At ₹7,499 less a 20% referral,
  ₹5,999.20 a year remains, about ₹166.64 per entity per month for three
  entities, before service cost. ₹7,499 uptake does not validate ₹14,999.
- **Remove optional breadth.** 2B, a CA workspace, bank CSV/PDF import, bill
  capture, questions and Hindi are separate workflows. Start with an accepted
  close. Use a fixed English/Hindi reminder before AI, one bank's CSV before PDF
  extraction, and recurring invoices as drafts.

Plan inconsistencies to fix: three firms moving three to five clients give
9–15 businesses (14–20 with five pilots), not 20–30. Weekly activity
misclassifies monthly rental billing. Top-ten SEO, 30% tool-led leads, 90%
renewal, cheap AI and the October 2026 Meta rates are unverified targets.

Recommended order:

1. Choose the pilot workflow and confirm compliance fit. Finish reports,
   opening-item import and accounting acceptance. Reconcile trial balance,
   party outstanding and bank balances at cutover.
2. Help three pilots finish a close their CAs accept. Track founder hours.
   Repeat the close before expanding.
3. Add the daily owner task pilots use: due list, invoice sharing, payment
   instructions. A payment link and confirmed collection are separate steps.
4. Test a paid offer and one real CA introduction. Choose 2B or CA oversight
   next from observed time saved.

Proposed pilot acceptance: two successive CA-accepted closes, reconciled
opening and closing balances, no unexplained source-to-report differences,
measured support hours, and paid continuation at an explicit price.

## Homepage message

Claims the evidence supports:

- Show one invoice, a recorded partial receipt and the balance left, with its
  source ledger. The shipped sample is ₹24,780 invoiced, ₹15,000 received,
  ₹9,780 due; label it as sample data.
- Show what the CA reviews and exports. A free CA login alone does not stop
  re-entry.
- State limits plainly: no bank feeds, no automatic history import, no
  e-invoicing.
- Use a walkthrough CTA while access is by invitation: "Book a walkthrough.
  Bring your CA."

Claims to avoid: faster payment, assured GST credit, instant bank data, free
full migration, reduced collection time, testimonials, savings figures,
anonymous Reddit reports as endorsements or competitor attacks.

If the artifact direction is kept, restructure its hero: one headline, two
short support sentences, one repeated CTA, one readable invoice → receipt →
balance story with consistent sample dates and statuses. Remove the stamp,
avatar, chat overlay and handwritten speed claim first. Keep planned features
in one small availability section. Translate the page only with a stated app
language limit.

Reference sites examined for layout (patterns, not conversion evidence):
[Stripe](https://stripe.com/), [Ramp](https://ramp.com/),
[Mercury](https://mercury.com/), [Xero](https://www.xero.com/),
[Zoho Books India](https://www.zoho.com/in/books/),
[Shopify](https://www.shopify.com/), [HubSpot](https://www.hubspot.com/),
[Slack](https://slack.com/intl/en-in/), [Razorpay](https://razorpay.com/),
[Notion](https://www.notion.com/). Slack's playable product story informed the
looping three-stage story.

## Palette and brand

Whatever palette is chosen: light surfaces with dark text, one filled treatment
for the primary action, status always carried by words or icons, 4.5:1 text
contrast, and a separately checked dark theme.

The blue option in full: canvas `#F7F8FA`, documents `#FFFFFF`, text `#202428`
and `#59636F`, action `#2457A7` (7.01:1 with white text), selection `#EAF1FB`,
success/warning/error `#17643B` / `#8A4B08` / `#B42318`.

## Next falsification

1. Observe the founder's rental workflow on a real prior month.
2. Through their CAs, observe four service owners and four rental operators.
   Each brings a redacted failed import, mixed receipt, disputed balance or
   hand-rebuilt report from the past 30 days. Reproduce it in their current
   paid software first. Drop the gap if the incumbent does it quickly once
   explained.
3. Keep the [five-firm CA gate](../validation/ca-interviews.md): three
   scheduled named-client trials pass; zero or one stops the bet. Its
   ₹2–50 crore target does not validate the smaller segment here.
4. Show the page to five owners or CAs. Ask what it does, what is available
   and what happens next. Check whether they infer automatic bank confirmation
   or assured GST credit.
5. Test monochrome, blue and lavender screens with the same content,
   counterbalanced. Record mistakes finding an unpaid balance, recording a
   partial payment and finding the export, separately from preference. Include
   keyboard use and 200% zoom.
6. Once real contact details and launch approval exist, measure qualified
   walkthrough requests per visit. Change one message or CTA at a time.

If only CAs feel the pain, revisit a CA-led product. If CAs want exports while
keeping Tally, test that handoff. If renters need lease or asset operations
first, do not hide that scope behind a rental headline.
