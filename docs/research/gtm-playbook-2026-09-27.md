# Go-to-market playbook: payer receivables for private hospitals

Researched 27 September 2026, from scratch. It reviews and replaces the
[manpower-contractor test](./hormozi-gtm-manpower-billing-2026-09-27.md) as the
first commercial bet. It is a plan to test. No prospect was contacted, no
money was spent, and no demand is proven.

## Answer

**Customer.** Private hospitals and nursing homes in India with 25–150 beds
that take cashless insurance (TPA) patients and government-scheme patients
(Ayushman Bharat PM-JAY and state schemes). The owner-doctor or managing
director buys. The TPA-desk head and the accountant use it.

**Problem.** Money owed by insurers, TPAs and government schemes leaks and
waits. Nobody in the hospital can say, per claim and per payer, what was
billed, approved, deducted, paid and still due.

**Wedge.** A payer-receivables ledger that works beside any hospital software
(HMS) and beside Tally. The hospital keeps both. Setup takes 7 days. The first
proof is a free report on the last 90 days of claims.

**Sold on its own.** This product needs no hospital software from us. It
imports from whatever HMS the hospital already runs. Cashless and scheme
claims are mostly inpatient (IPD) bills, so they come from the customer's
HMS, not ours. Our HMS covers only OPD and pharmacy today, and that does not
block this sale. Do not sell or mention our HMS in this motion.

**Sell as a neutral vendor, not as a hospital owner.** Other hospital owners
can see a rival owner as a competitor. A rival who asks for their claim data
is worse. So Accly sells. See [Identity rule](#identity-rule).

**Knowledge gap.** The founder's hospital takes no insurance and has no NABH
accreditation. Learn the claim workflow in a two-week sprint before cold
volume. See [Knowledge gap](#knowledge-gap-learn-the-insurance-workflow-first).

**Moat.** None today. Three can be earned, in this order:

1. **Borrowed and earned expertise.** A former TPA-desk advisor, then what
   you learn from every report. The prospect feels it in the questions. The
   founder's hospital experience helps with operations in general, not with
   insurance.
2. **Payer data network.** Every hospital adds deduction and delay data per
   insurer and TPA. After 20 hospitals you can show "Insurer X deducts 9% on
   room rent at your peers, you lose 14%". A new competitor starts with zero.
3. **Association channel.** State hospital associations fight payers as a
   group and need hard numbers. Become the tool that produces their
   pending-dues statement. One association brings hundreds of members.

**Why not "grow one customer at a time" with a general product?** Tally, Zoho,
Vyapar and myBillBook price a general ledger near zero, and CAs keep clients on
Tally. A general product sold by cold calls competes on price with a free plan.
A vertical ledger with a money result can charge 10× more and is easier to find
and to prove.

## Review of the manpower-contractor doc

Keep its honesty about evidence and its stop rules. Its gaps:

- **No comparison.** It chose one niche and never scored the others.
- **It ignores your unfair advantage**: a hospital, a school and an HMS.
- **The workflow does not productize.** Each corporate or government buyer
  sets its own bill checklist, so every customer is custom work. Hospitals
  face a small, repeated set of payers: about 30 insurers, a few TPAs and the
  government schemes.
- **The paid offer is consulting.** A ₹19,900 manual sprint has no software
  leverage and no moat.
- **No feature wedge.** You can ship a feature a week; the doc used none.
- **Volume is too low.** 15 approaches a week gives no signal in a month.
  Hormozi's rule is 100 outreaches a day.
- **It ignores outreach law.** Cold calls from a 10-digit mobile are
  non-compliant in India since February 2025 (see [Outreach setup](#outreach-setup)).
- **The guarantee has no teeth**, and the offer has no urgency.

## Method

Six research passes on 27 September 2026:

- Hormozi material in
  [antonio-clicktoclose/hormozi-claude-code-brain](https://github.com/antonio-clicktoclose/hormozi-claude-code-brain/tree/3167733e566504a717b8051c176c730e02271f69)
  (commit `3167733`). It holds the 2025 $100M Playbooks (Branding, Closing,
  Pricing, Lead Nurture, Proof, Fast Cash, Lifetime Value, Retention) and the
  Scaling Roadmap transcripts. It does **not** hold $100M Offers, $100M Leads
  or $100M Money Models, and it has no cold-email or cold-call scripts.
- Hormozi's own words from outside the repo, to fill those gaps: his reading
  of [$100M Leads, Part 5: Cold Outreach](https://podscripts.co/podcasts/the-game-with-alex-hormozi/part-5-cold-outreach-100m-leads-book)
  (machine transcript), the [$100M Money Models course](https://www.acquisition.com/training/money/offer-types),
  the [$100M Offers course](https://www.acquisition.com/training/offers) and
  his posts on X. Where only a third-party summary exists, the doc says
  "secondary". The scripts are my adaptations of these rules. Hormozi says
  nothing about selling to a buyer who sees you as a competitor, so
  [that section](#selling-to-a-buyer-who-sees-you-as-a-rival) applies his
  general principles to it.
- Indian segments, global compliance deadlines, global moat patterns, and
  outreach law and deliverability.

Reddit blocked the fetcher, so there are no Reddit quotes. Several figures
come from vendor blogs; they are marked **(vendor)**.

## Segments scored

Hormozi's four tests are pain, purchasing power, easy to target and growing
market ([Branding playbook](https://github.com/antonio-clicktoclose/hormozi-claude-code-brain/tree/3167733e566504a717b8051c176c730e02271f69/playbooks)).
I added two: product fit today and founder advantage. Scores are 1–5 and are
judgements.

| Segment                                          | Pain | Money | Target | Growth | Fit | Edge | Verdict                               |
| ------------------------------------------------ | ---- | ----- | ------ | ------ | --- | ---- | ------------------------------------- |
| **Private hospitals: payer receivables**         | 5    | 4     | 5      | 4      | 4   | 2    | **Choose**                            |
| Indian service exporters (forex, LUT, refunds)   | 3    | 4     | 4      | 5      | 3   | 1    | Fallback                              |
| UAE SMEs, e-invoicing from 1 Jul 2027            | 4    | 4     | 4      | 4      | 2   | 2    | Gate in Dec 2026                      |
| CA firms as buyers                               | 4    | 2     | 5      | 3      | 3   | 1    | Channel only                          |
| Manpower contractors (old doc)                   | 4    | 3     | 3      | 3      | 3   | 1    | Reject                                |
| D2C and marketplace sellers                      | 5    | 2     | 4      | 4      | 1   | 1    | Reject: needs stock, saturated        |
| Multi-entity Xero/QBO users (UK, US, AU)         | 3    | 4     | 3      | 3      | 2   | 1    | Reject: bank feeds, VAT, trust        |
| Offshore bookkeeping firms (layer over QBO/Xero) | 4    | 3     | 5      | 4      | 1   | 1    | Reject: a different product           |
| Indian SMBs, general books                       | 3    | 2     | 3      | 3      | 4   | 1    | Reject: Zoho free plan, Tally lock-in |

### Why hospitals win

**Pain is acute, current and in rupees.**

- About 650 private hospitals in Haryana said the state owes about ₹1,200
  crore in Ayushman Bharat claims. The claims have waited over six months
  against a 15-day norm. They threatened to stop new scheme patients from
  16 September 2026
  ([Deccan Herald](https://www.deccanherald.com/india/haryana/haryanas-600-private-hospitals-to-suspend-ayushman-bharat-due-to-pending-reimbursements-3374507);
  [MedGate Today](https://medgatetoday.com/private-hospitals-to-suspend-ayushman-services-over-payment-delays-in-haryana/)).
- 135 hospitals in Jammu and Kashmir claimed ₹295 crore in pending dues and
  threatened to exit the scheme from 1 July 2026
  ([Medical Dialogues](https://medicaldialogues.in/news/health/hospital-diagnostics/jnk-hospitals-threaten-suspension-of-ayushman-bharat-services-over-rs-295-crore-dues-168217);
  [Kashmir Reader, 1 Jul 2026](https://kashmirreader.com/2026/07/01/private-hospitals-to-continue-ayushman-bharat-services-after-govt-assurances/)).
- The hospital association AHPI told members to stop cashless service for
  Bajaj Allianz patients. It cited unilateral tariff cuts, late settlement and
  denial of pre-approved claims
  ([Hodo, vendor](https://hodo.in/post-ahpi-bajaj-allianz-cashless-cutoff.html)).
- The IRDAI chairman said high settlement ratios can hide that paid amounts
  are much lower than claimed
  ([Business Standard, Nov 2025](https://www.business-standard.com/finance/personal-finance/partial-hospital-bill-payout-boost-policy-cover-to-secure-full-claims-125111401478_1.html)).
- Vendors claim that 25–45% of a mid-size hospital's inpatient revenue is
  cashless, and that revenue-cycle gaps cost 12–22% of revenue
  ([Hodo](https://hodo.in/post-bajaj-allianz-cashless-halt-tpa-playbook.html);
  [ICG](https://ichelonconsulting.com/revenue-cycle-management-hospital)).
  **(vendor)** Verify these on real claims.

**They have money.** India has about 38,000 private hospitals
([Medical Buyer](https://medicalbuyer.co.in/indias-private-hospitals-record-27-growth-with-number-touching-38000/)).
The sector is worth about $122 billion in 2025, growing to about $202 billion
by 2030 ([Brickwork Ratings, Nov 2025](https://www.brickworkratings.com/Research/Private%20Hospitals%20report_10Nov2025.pdf)).

**They are easy to find.** Scheme, insurer and accreditation lists are public
(see [Where to find them](#where-to-find-them)).

**The product fits.** A claim is an invoice to a payer. A settlement is a
receipt with an allocation. A deduction is a credit note with a reason. The
payer's TDS is already in the TDS register. Many hospitals are groups: a trust,
a pharmacy company and a diagnostics firm. Many entities under one login
already exist.

**The honest limit.** Software cannot make a government or an insurer pay. The
product gives the hospital an exact, per-claim position so it can appeal,
escalate and stop repeat deductions. Never promise faster payment. The
promise is "know every rupee owed and why".

### Competition

HMS vendors sell TPA modules: Medical365, CureNearMe, PatientERP, ACG and Hodo
([Medical365](https://www.medical365.in/blogs/hospital-billing-software-india);
[CureNearMe](https://curenearme.com/products/hospital-billing-software-india);
[PatientERP](https://patienterp.com/highlights/insurance-tpa-management.html)).
Each needs the hospital to change its whole HMS, which is a clinical change.
Hospital finance modules are often thin and export to Tally, so CFOs run
parallel books ([Finstein](https://erpnext.finstein.ai/resources/hospital-hims-guide/),
vendor, 7 May 2026). **Your angle: do not replace the HMS or Tally. Sit between
them and own the payer ledger.** Test this in the first 20 calls. If most
prospects say their HMS already does this well, stop.

## The offer

The repo lacks $100M Offers, so this section follows his published steps:
pick a starving crowd, define the dream outcome, list every problem, turn
each problem into a solution, choose delivery vehicles, then trim and stack
([$100M Offers course](https://www.acquisition.com/training/offers); step
list via [Greg Faxon](https://www.gregfaxon.com/blog/100m-offers-summary),
secondary). The book's goal is an offer "so good people feel stupid saying
no".

### Value equation

Dream outcome × likelihood ÷ (time × effort).

| Driver        | Design                                                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dream outcome | Every rupee owed by each insurer, TPA and scheme, per claim, with the reason for every deduction.                                                    |
| Likelihood    | Prove it on their own last 90 days before they pay. Until a customer allows an anonymized case, show a sample report built from real redacted files. |
| Time          | Free report in 48 hours. Live in 7 days.                                                                                                             |
| Effort        | They export two files they already have. We do the mapping. No HMS change. No Tally change.                                                          |

### Problems and named solutions

Each row is an obstacle the owner believes in, and the named piece that
removes it. Hormozi's rule: every bonus answers one objection, and tools and
checklists beat extra training.

| The owner thinks                           | Driver     | Named solution                                                                                                 |
| ------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------- |
| "I don't know what each payer owes me."    | Likelihood | **Payer Ledger**: every claim, billed → approved → deducted → paid → due.                                      |
| "Our HMS export is a mess."                | Effort     | **Done-for-you Import**: we map your export. Your staff send files, nothing more.                              |
| "Insurers will deduct anyway."             | Likelihood | **Deduction Decoder**: deductions grouped by reason, with the top 3 that your desk can prevent.                |
| "The same cuts keep coming back."          | Likelihood | **Payer Rulebook**: a document checklist per insurer and TPA.                                                  |
| "Appeals take too long to write."          | Time       | **Appeal Letter Pack**: templates for the most common deduction reasons. Your team decides what to send.       |
| "Scheme money is stuck whatever I do."     | Likelihood | **Dues Dossier**: a claim-level pending statement, ready for the scheme office or your association.            |
| "Setup will take months."                  | Time       | **7-Day Go-Live**, or the setup is free.                                                                       |
| "My CA won't trust another system."        | Likelihood | **CA Handover Pack**: payer receivables exported to Tally, with a reconciliation sheet.                        |
| "When my TPA clerk leaves, it all resets." | Likelihood | **Desk Playbook**: the written weekly routine, so a new clerk continues from day one.                          |
| "My data could reach a competitor."        | Likelihood | **Vault Agreement**: no patient names, two named people with access, deletion on exit, signed before any file. |

### Trim and stack

- **Core:** Payer Ledger, Done-for-you Import and Deduction Decoder, with a
  weekly exception list and one monthly review call.
- **Bonuses, released one at a time on the report call:** Payer Rulebook,
  Appeal Letter Pack, Dues Dossier, CA Handover Pack and Desk Playbook.
- **Always included, never a bonus:** 7-Day Go-Live and the Vault Agreement.
  They are the terms of trust.
- **Cut:** anything that needs a clinical change, such as pre-authorization
  in the HMS, and anything we cannot deliver by hand this month.
- **Bonus values:** Hormozi gives each bonus a price. Quote a value only from
  a real price, such as your CA's written quote for the same work. Otherwise
  state the hours it saves. An invented value breaks trust with a buyer who
  already distrusts you.

### Price

- ₹9,999 a month, or ₹99,990 a year paid upfront. The monthly price stays
  under the ₹15,000 UPI AutoPay limit, above which each debit needs OTP
  authentication
  ([Business Today, Apr 2026](https://www.businesstoday.in/personal-finance/news/story/rbi-caps-recurring-payments-at-rs15000-without-otp-under-new-e-mandate-framework-526759-2026-04-21)).
- Setup ₹24,999, waived on the annual plan.
- Pitch annual first, as the Pricing playbook advises: annual payers churn
  far less.
- **Founding ladder:** the first 5 hospitals pay 80% off in return for a case
  study, a video testimonial and two referrals. Raise the price by 20% after
  each 5 sales, until full price. Never cut the price on a call; add a bonus
  instead.

### Scarcity and urgency

Use only real limits. Hormozi: "Make sure they are real. If they aren't,
you'll lose credibility" (via Greg Faxon, secondary).

- **Capacity:** "We onboard 3 hospitals a month." This is true for one
  founder doing imports by hand.
- **Cohorts:** go-live on the 1st of each month only.
- **Price:** the founding price rises after every 5 customers. Say how many
  seats are left.
- **Season:** year-end, 31 March. Payer TDS must match Form 26AS before the
  books close. From January, lead with this.

### Guarantee stack

1. **10× Find Guarantee (conditional):** "If the first 60 days do not find at
   least 10× your fee in short payments, unexplained deductions, TDS
   mismatches or claims over 60 days, we refund every rupee."
2. **7-Day Go-Live:** "If you are not live in 7 days after we receive your
   files, the setup is free, and we keep working until you are."
3. **Vault guarantee:** "If we ever breach the Vault Agreement, you get a full
   refund and can end the contract at once."

These promise what you control: money **found**, speed and data care. Never
promise money **collected**. Offer the paid plan only when the free report
already shows 10× the fee.

### Name

MAGIC: a magnetic reason, the avatar, the goal, the interval and a container
word.

**"Founding-5 Payer Money Map for Nursing Homes: 90 days of insurer money,
found in 48 hours."**

- Reason: Founding-5.
- Avatar: nursing homes.
- Goal: insurer money found.
- Interval: 48 hours.
- Container: Map.

### Money model

These use the offer types in the
[$100M Money Models course](https://www.acquisition.com/training/money/offer-types).

| Stage      | Type                   | Our version                                                                                                                    |
| ---------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Attraction | Free giveaway          | The Payer Leak Report on their last 90 days.                                                                                   |
| Attraction | Win your money back    | The 10× Find Guarantee.                                                                                                        |
| Upsell     | Anchor                 | Show the Claim Follow-up Desk first (our team chases aged claims for 3–5% of the amount collected). Then the plan looks small. |
| Upsell     | Classic, about 5× core | Full books for the hospital group (trust, pharmacy, diagnostics) on Accly Books, with their CA.                                |
| Upsell     | Rollover               | A paid quarterly report fee counts in full toward the annual plan within 30 days.                                              |
| Downsell   | Payment plan           | Monthly instead of annual.                                                                                                     |
| Downsell   | Feature downsell       | The Payer Leak Report every quarter, ₹14,999 a report, with no software.                                                       |
| Continuity | Waived fee             | Setup fee waived on annual.                                                                                                    |
| Continuity | Continuity bonus       | Annual customers get a fresh Dues Dossier every quarter.                                                                       |

Raise prices once a year. Never sell lifetime deals.

### Lead magnet details: the Payer Leak Report

- **Input:** the HMS bill register for 90 days, and the TPA and insurer
  settlement advices (the Excel files or emails they already receive). Add
  scheme portal exports if they have them.
- **Output in 48 hours:** amount billed, approved, deducted, paid and
  outstanding, per payer. Deductions grouped by reason. Claims older than 30,
  60 and 90 days. Payer TDS to check against Form 26AS.
- **Data rule:** claim number and bill amount only. No diagnosis, no patient
  name. Sign the Vault Agreement first.
- It does all three jobs of a good lead magnet: it reveals the problem, gives
  a taste of the fix, and is step 1 of the paid service.

## Knowledge gap: learn the insurance workflow first

The founder's hospital takes no insurance or scheme patients and has no NABH
accreditation. So there is no pilot site for this product, and no first-hand
knowledge of the claim workflow. This changes the plan in three ways:

1. **Edge drops.** The founder is still a hospital operator, but not an
   insurance operator. Hospitals still rank first on pain, money and reach,
   but the lead over service exporters is smaller.
2. **No case study at the start.** The first proof must come from the first
   free reports, with written permission to show them anonymized.
3. **Learn before selling volume.** Hormozi's answer to "no skill, no proof"
   is to do the work free, many times, until you are good (Rule of 100; the
   free → 80% off → full-price ladder). The free report is the learning
   tool.

### How the workflow runs (to confirm in interviews)

This outline comes from public rules and vendor guides. Confirm each step with
TPA desk heads before building anything.

**Private insurance, cashless:**

1. **Empanelment.** The hospital signs a network agreement and tariff with each
   insurer or TPA. For public-sector insurers this is the shared PPN tariff.
2. **Admission.** The insurance desk checks the policy or e-card and sends a
   pre-authorization request with the doctor's notes and a cost estimate.
3. **Approval.** IRDAI requires a decision on cashless requests within 1 hour.
4. **Enhancement.** If costs rise, the desk asks for more.
5. **Discharge.** The desk sends the final bill and discharge summary. IRDAI
   requires final authorization within 3 hours
   ([IRDAI Master Circular, 29 May 2024](https://irdai.gov.in/documents/37343/365525/%e0%a4%b8%e0%a5%8d%e0%a4%b5%e0%a4%be%e0%a4%b8%e0%a5%8d%e0%a4%a5%e0%a5%8d%e0%a4%af+%e0%a4%ac%e0%a5%80%e0%a4%ae%e0%a4%be+%e0%a4%b5%e0%a5%8d%e0%a4%af%e0%a4%b5%e0%a4%b8%e0%a4%be%e0%a4%af+%e0%a4%aa%e0%a4%b0+%e0%a4%ae%e0%a4%be%e0%a4%b8%e0%a5%8d%e0%a4%9f%e0%a4%b0+%e0%a4%aa%e0%a4%b0%e0%a4%bf%e0%a4%aa%e0%a4%a4%e0%a5%8d%e0%a4%b0+_+Master+Circular++on+Health++Insurance+Business++29052024.pdf/5e707a91-b5de-1ec1-cf18-b66273a6839d?t=1716962621002&version=1.0)).
   The patient pays the items the policy does not cover.
6. **Claim file.** The hospital submits the full claim file to the TPA.
7. **Settlement.** Weeks or months later, money arrives by bank transfer with
   a settlement advice. The advice lists the approved amount, the deductions
   and the TDS.
8. **Reconciliation.** The desk matches the transfer to the bill and books the
   deduction. This is the step the product owns.

**PM-JAY and state schemes:** beneficiary check, pre-authorization with
package codes on the scheme portal, treatment, claim submission, then
payment by the State Health Agency, with deductions or rejections visible on
the portal. **Confirm these steps and the export formats with an empanelled
hospital.**

**Watch NHCX.** The National Health Claims Exchange sends claims digitally in
a standard format. About 12,600 hospitals had joined by May 2026. IRDAI has
recommended that all insurers, TPAs and network hospitals integrate, but it
is not mandatory yet
([Healthixio, vendor](https://healthixio.com/blog/view/nhcx-integration-guide-hospitals/);
[ABDM brochure](https://abdm.gov.in/strapicms/uploads/NHCX_Brochure_ffdb63d9bc.pdf)).
It is an opportunity: settlement data could arrive as structured files, not
PDFs. It is also a risk: if NHCX shows every deduction clearly, the gap gets
smaller. Ask in every interview whether the hospital uses it.

### Two-week learning sprint (before cold volume)

- **Interview 15 TPA desk heads or billing managers.** Use warm introductions
  first. Ask them to walk you through their last settlement. Do not pitch.
  Ask:
  - "Show me the last settlement advice you received. What did you do with
    it?"
  - "Where do you record deductions? Who sees that?"
  - "Which payer is hardest? Why?"
  - "What does your HMS show about payer dues? What is missing?"
  - "Do you use NHCX or a payer portal? What can you export?"
  - "What would you want to know every Monday morning?"
- **Collect 5 real, redacted settlement advices** and 3 bill-register exports
  under the Vault Agreement. The import feature is built from these.
- **Borrow the expertise.** Hire a former hospital TPA coordinator or
  insurance-desk manager as a part-time advisor for 5–10 hours a week. Pay a
  fixed fee plus a bonus per paying hospital. They check the reports, correct
  the scripts, and can join calls. This is also a lead getter.
- **Build a sample report** from the redacted files. It replaces the pilot-site
  case study until the first customer allows an anonymized case.
- **Gate:** start cold volume only when you can explain the workflow back to
  3 desk heads without correction, and you hold 5 real settlement advices. If
  10 interviews show the HMS already solves this, switch to the fallback.

## Features to build

Each feature takes about a week. Build one only after 5 Payer Leak Reports
have been done by hand in a spreadsheet and the same need appears in at least
3 of them. The order follows the offer.

1. **Payer statement and bill import.** CSV/XLSX mapping for HMS bill
   registers and the settlement-advice formats of the top 5 TPAs. A claim
   becomes an Invoice to a payer Party. A settlement becomes a Receipt with
   allocations. A deduction becomes a Credit Note with a reason code.
2. **Payer ageing and exceptions.** Ageing by payer and by status. The
   deduction-reason report. A weekly email digest.
3. **Payer TDS match.** Compare payer TDS with the Form 26AS/AIS export.
4. **Tally export of payer receivables.** This is already planned as the
   next export after XLSX.
5. **Later:** doctor fee-share statements with 194J TDS, and a group view
   across trust, pharmacy and diagnostics.

Keep to the [product rules](../product.md#invariants). A spec per slice
decides the details. This list does not open any scope.

## Where to find them

- **Scheme lists:** the PM-JAY hospital directory lists empanelled hospitals
  by state and district. Start with states that have public disputes over
  dues, such as Haryana, Jammu and Kashmir and Punjab. A hospital in a public
  dispute has the pain now.
- **Insurer and TPA network lists:** Star Health, Care, Niva Bupa, Medi
  Assist and others publish network-hospital lists with addresses and phone
  numbers. Every hospital on them has TPA receivables.
- **NABH lists:** the accredited and entry-level lists. These hospitals have
  process discipline and budget.
- **Associations:** AHPI state chapters, IMA hospital boards, and state
  nursing-home associations. Go to a meeting in person. Offer a free
  pending-dues statement for members.
- **LinkedIn:** titles such as "Hospital Administrator", "Medical Director",
  "TPA Coordinator" and "Billing Manager".
- **Warm first:** CAs who audit hospitals, TPA field officers (they know every
  billing desk in the city) and your doctor network. Ask each one for an
  introduction to the Accly team, not to you as a hospital owner.
- **Skip your own catchment for the first 90 days.** Hospitals that compete
  with yours for patients are the most likely to distrust you. Start in other
  districts or other states.

## Lead getters

$100M Leads names four lead getters beyond your own outreach: customer
referrals, employees, agencies and affiliates (secondary,
[Shortform](https://www.shortform.com/blog/100m-leads-alex-hormozi/)).
Hormozi's companies reportedly grew through affiliates that sold to one
avatar (secondary). Here they also solve the rival problem, because each one
brings trust you cannot bring yourself.

- **Customer referrals.** Two-sided: the referrer and the new hospital each
  get one month free. Ask on every report call and again at day 30.
- **CAs who audit hospitals.** They see the leak at audit time. Offer them a
  free Accly workspace for their hospital clients, not cash. ICAI rules limit
  commissions to CAs in practice; check them before you offer any fee.
- **Billing and NABH consultants.** They are independent, so a paid referral
  is possible: 20% of the first year's fee. Put it in writing.
- **State associations.** Offer a free association-wide Dues Dossier, built
  from members who opt in. One meeting reaches hundreds of owners.
- **TPA field officers.** Ask for introductions only. Do not pay them. They
  work for the payer, so a payment would be a conflict of interest.

## Outreach setup

Get these legal points right before you send volume.

- **Calls.** Since 12 February 2025, commercial calls from any 10-digit
  mobile number are non-compliant. Promotional calls must use a 140-series
  number. Five complaints in 10 days can disconnect you
  ([TRAI regulation](https://trai.gov.in/sites/default/files/2025-02/Regulation_12022025.pdf)).
  - For volume, get a 140-series number through a registered telemarketer or
    a cloud-telephony provider.
  - Use your own mobile only after a reply, a referral or a request for a
    call.
- **Email.** Under the DPDP Act, marketing has no "legitimate interest"
  ground. The notice and consent duties start on 13 May 2027
  ([PIB](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2190014)).
  - Until then, write only to addresses the business publishes itself, and
    keep a record of where each one came from.
  - Include an opt-out in every email. Do not buy MCA director lists.
- **WhatsApp.** Send nothing without an opt-in first. Ask on the call: "Can I
  send the sample report on WhatsApp?"
- **Deliverability.**
  - Use 2 secondary domains with 3 inboxes each, and warm them for 4 weeks.
  - Send 20–30 emails per inbox per day, and keep bounces under 2%.
  - Set up SPF, DKIM and DMARC, plus one-click unsubscribe
    ([Gmail sender rules](https://support.google.com/mail/answer/14229414?hl=en)).
  - Tools cost about ₹5,000–8,000 a month (Instantly or Smartlead, plus
    Google Workspace).
- **Benchmarks:** the average cold-email reply rate is 3.4%, and the top
  quarter reaches 5.5% or more. 58% of replies come from the first email
  ([Instantly 2026](https://instantly.ai/cold-email-benchmark-report-2026),
  vendor).
- **Check with a lawyer** before scaling calls. This is research, not legal
  advice.

## Sales system and scripts

No script works every time. Hormozi's claim is narrower: one script, said the
same way on every call, plus enough volume, beats talent. "You can make up for
your lack of skill with volume. Volume negates luck"
([$100M Leads, Part 5](https://podscripts.co/podcasts/the-game-with-alex-hormozi/part-5-cold-outreach-100m-leads-book),
24:14). He trains reps for script adherence. When sales drop, he first reads
the team last week's testimonials, not a new script: "Conviction solves almost
any sales problem" ([X](https://x.com/AlexHormozi/status/1834705881864577245)).
The scripts below are therefore fixed. Use them word for word.

### Rules of the system

1. **Three slots only:** `{Dr Name}`, `{Hospital}` and `{Fact}`. Nothing else
   changes between prospects.
2. **`{Fact}` comes from a fixed menu.** Hormozi says to personalize with "one
   to three pieces of information a friend might know" (Part 5, ~13:52). Pick
   the first one that is true:
   - "on the PM-JAY list for {district}"
   - "on the {Insurer} network list"
   - "NABH accredited"
   - "a member of {state association}"
3. **One version at a time.** Give each script a version number. Run a version
   for at least 500 emails or 200 dials. Then change **one** line and compare
   the rates. This batch size is my rule, not a Hormozi number.
4. **Lead with big, fast value, never a demo.** His take rates tripled when he
   gave free work instead of a sales call (Part 5, 15:15). Here the free work
   is the Payer Leak Report.
5. **Many touches, many channels.** Email, then a call "about my email", then
   WhatsApp after opt-in. After the last touch, rest the lead for 90 days and
   start again (Part 5, 23:54).
6. **Book the next meeting from every meeting.**
7. **Know the benchmarks.** Hormozi's figures (Part 5, 26:28–27:14):
   - About 3% of an email list becomes engaged leads.
   - 100 dials give about 20 pickups and about 4 engaged leads.

   Below these, fix volume first, then the list, then one line of the script.

### Identity rule

Accly sells. The founder's hospital never appears in the first touch.

- Send from the Accly domain, with an Accly signature and an Accly phone line.
  Never use the hospital's letterhead, email or number.
- For proof, show the sample report, and later an anonymized customer report
  with written permission. Never call your own hospital a pilot site for this
  product; it takes no insurance.
- If a prospect asks you directly, answer truthfully and briefly. Then move to
  data protection:

  > "Yes, I run one in {state}. It doesn't take insurance patients, so this
  > product isn't built on it. And your data never goes near it. Your files stay with
  > Accly under a signed agreement, and only two named people can see them.
  > Should I send the agreement first?"

- Never lie about ownership. A discovered lie ends the deal and your name in
  the association.

### Selling to a buyer who sees you as a rival

Hormozi has no lesson on this. This playbook applies his general principles
to it. Each row is one principle and what to do with it.

| His principle                                                                      | What to do                                                                                                                                |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| "Proof > Promise" ([X](https://x.com/AlexHormozi/status/1816190174541586567))      | Let their own numbers do the selling. A rival's title means nothing next to ₹ found in their own claims.                                  |
| "Give first, Ask last" ([X](https://x.com/AlexHormozi/status/1864674521451798586)) | The free report comes before any identity question. People rarely distrust someone who has already helped them.                           |
| Big fast value beats a sales call ($100M Leads, Part 5)                            | Deliver in 48 hours. Speed shows you work for them, not for yourself.                                                                     |
| Category of one (Offers, secondary)                                                | Accly is not a hospital and not an HMS. It is a payer ledger. There is nothing to compare it with, and no one to compete with.            |
| Conditional and performance guarantees put you on the buyer's side                 | Your fee depends on finding their money. A rival would not sign that.                                                                     |
| Lead getters borrow other people's trust ($100M Leads, secondary)                  | Enter through neutral people: CAs, associations, TPA desk heads. Their trust replaces yours.                                              |
| Label the problem (CLOSER)                                                         | Name a common enemy: payer deductions. You and the hospital are on the same side against the insurer. That turns a rival into a teammate. |
| Status is a lever (Fast Cash playbook)                                             | Make the desk head the hero in front of the MD. Make the owner look smart in front of peers, with an anonymous peer benchmark.            |
| Remove risk from the decision (value equation: likelihood)                         | Sign the Vault Agreement first. Offer to receive files through their own CA. Name the two people who see the data.                        |

**Operational rules that follow:**

- Accly is its own company, with its own domain and phone line. Name the two
  people with data access, and do not make one of them a staff member of your
  hospital.
- Never meet prospects at your hospital. Meet at theirs, at an association
  event, or on video.
- At association events, the association hosts and you teach. Teach the
  deduction patterns, not your hospital.
- If a prospect is a direct local rival, say so first and offer to send
  files through their CA only. Naming the conflict yourself builds more trust
  than hiding it.

### Who to call first

Call the **TPA desk head** first, not the owner. The TPA desk head feels the
pain every day and does not compete with you. They see a tool that makes
them look good to the MD. The owner comes second, through the desk head or
after an email reply.

### Email sequence (version 1)

**Email 1, day 0.** Subject: `{Hospital}: TPA deductions`

> Dr {Dr Name}, I saw {Hospital} is {Fact}.
>
> Can your TPA desk say, claim by claim, what each insurer deducted last
> quarter and why?
>
> Send us your 90-day bill export and settlement advices (claim numbers and
> amounts only). In 48 hours we send back what each payer owes you and why
> they cut it. Free.
>
> Should I send our data agreement first?
>
> {Your name}, Accly · {address} · Reply "no" and I won't write again.

When a customer allows it, add one line: "At a {N}-bed hospital in {state} it
was ₹{X} in 90 days." Never invent the figure.

**Email 2, day 3.**

> Dr {Dr Name}, one common example: proportionate deductions when the room
> is above the policy limit. Each bill looks small. Across 90 days it is often
> the biggest line. Should we check {Hospital}'s?

**Email 3, day 7.**

> Dr {Dr Name}, if your TPA desk handles this, I can send them the file list
> directly. Who runs insurance settlements at {Hospital}?

**Email 4, day 14.**

> Dr {Dr Name}, I'll close this for now. If insurer dues become urgent, reply
> "report" and we'll start within a day.

Then rest the lead for 90 days and restart at email 1.

### Call scripts (version 1)

Use the 140-series line for cold calls. Use Hindi or English, as the other
person prefers. The words stay the same.

**Reception:**

> "Hello, {Your name} from Accly, calling about insurance settlements. Who
> handles TPA claims there? Could you connect me, please?"

**TPA desk head:**

> "Hi, {Your name} from Accly. Is now a terrible time?
>
> We help TPA desks show, claim by claim, what each insurer deducted and why.
> One question: if your MD asked you right now how much the insurers deducted
> last quarter, how long would it take you to answer?"

- **"Days", or "I can't":**

  > "That's what we fix. We'll do your last 90 days free, in 48 hours. You
  > export two files. What's the best email for the file list? Can I send it
  > on WhatsApp too?"

- **"We already have it":**

  > "Then you're ahead of most. What do you use? Would a free second check on
  > 90 days hurt?"

- **"Talk to the MD":**

  > "Sure. Can I copy you on the email, so you get the credit when it works?"

**Owner.** Call after an email reply, or through the desk head:

> "Dr {Dr Name}, {Your name} from Accly. Your TPA desk asked me to call. We're
> preparing {Hospital}'s free 90-day payer report. Before we start, which
> payer worries you most?"

**Voicemail:**

> "Hi, {Your name} from Accly, about insurer deductions at {Hospital}. I sent
> an email with the subject 'TPA deductions'. My number is {number}."

**WhatsApp**, only after an opt-in. Send the data agreement PDF and this
message:

> "As promised: please send the 90-day bill register and the TPA settlement
> advices. Claim numbers and amounts only, no names. Report in 48 hours."

### Warm outreach script (version 1)

Use this for doctors and contacts you already know. It follows Hormozi's
Acknowledge, Compliment, Ask pattern and ends with a referral ask (secondary,
[saasboyx](https://saasboyx.substack.com/p/warm-outreach-hormozi-style)). A
referral ask puts no pressure on the contact, and it avoids the rival
problem.

> "Dr {Dr Name}, I saw {Fact}. Well done, that's hard work.
>
> Quick question. I'm building Accly, a tool that shows hospitals exactly
> what each insurer deducted and why. Do you know one hospital owner or
> administrator who is fighting TPA deductions right now? We do their first
> 90-day report free."

### Report call and close (version 1)

The report call follows CLOSER and the 3-pillar pitch. Use plain words, no
feature list
([CLOSER](https://x.com/AlexHormozi/status/1522576956054589440); 3-pillar
pitch, The Game Ep 790, secondary).

1. **Clarify:** "What made you send the files?"
2. **Label:** "So you can't see payer money claim by claim, and deductions
   repeat. Is that right?"
3. **Overview past pain:** "What have you tried? How did it work?"
4. **Sell the vacation.** Show three numbers from their own report: the total
   found, the biggest deduction reason, and the oldest unpaid claims. Then
   give the three pillars:
   - **Know:** "every claim, like a bank statement for each insurer."
   - **Fix:** "a checklist per payer, so the same cut doesn't happen twice."
   - **Chase:** "a weekly list of what is overdue, and who owns it."
5. **Explain away concerns:** use the table below. Answer each concern with
   the bonus built for it, one at a time: Vault Agreement for data, CA
   Handover Pack for the accountant, Desk Playbook for staff turnover.
6. **Ask:**

   > "The annual plan is ₹99,990. As one of our first five hospitals, you pay
   > 80% less, in return for a case study. If we don't find 10× your fee in 60
   > days, you get every rupee back. Should the invoice go to you or to your
   > accountant?"

7. **Reinforce.** After the yes, stop selling:

   > "Good decision. In the next 7 days we import your files and set up your
   > payers. Let's book the setup call now."

### Objections (version 1)

| Objection                                            | Answer                                                                                                                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Never heard of Accly."                              | "Fair. That's why we start with your own data, free. Judge the report, not us."                                                                                   |
| "Do you own a hospital?"                             | Use the [identity rule](#identity-rule) answer.                                                                                                                   |
| "Our HMS has a TPA module."                          | "Good. Then the report takes 2 minutes to disprove. If your HMS already shows every deduction by reason, I'll tell you not to buy."                               |
| "The scheme is late because the state has no money." | "True, and we can't fix that. We make sure every claim is counted when money is released. The insurer deductions are a different leak, and that one you can fix." |
| "My accountant handles it."                          | "Let's show your accountant the report. If they already have this per claim, you've lost nothing."                                                                |
| "Patient data is sensitive."                         | "We take claim number and amount only. No names, no diagnosis. Here's the agreement."                                                                             |
| "Too expensive."                                     | "The report shows the rupees first. If it doesn't find 10× the fee, you pay nothing."                                                                             |
| "Let me think about it."                             | "What would make this a no? Deciding doesn't take time, it takes information. What's missing?"                                                                    |
| "Send me details."                                   | "Happy to. The fastest detail is your own report. Can your desk send the two files today?"                                                                        |

### Tracking sheet

One row per day per channel. The columns are:

- date and script version
- emails sent, or dials made
- connects and replies
- reports requested, files received and reports delivered
- money found
- offers made, paid customers and referrals

Review the sheet every Friday. Change at most one line in one script per
week.

## 90-day plan and scoreboard

**Daily, Monday to Friday.** This is Hormozi's Rule of 100, adapted for one
founder:

- 100 personal emails.
- 30–40 calls to TPA desks and administrators.
- 20 minutes of warm follow-ups and LinkedIn comments.

**Weeks 1–2.**

- Run the [learning sprint](#two-week-learning-sprint-before-cold-volume):
  15 desk-head interviews, 5 real settlement advices, one advisor and a
  sample report.
- Set up the domains, the 140-series line and the data agreement.
- Build a list of 500 hospitals in 3 states.
- Contact 30 warm contacts.

**Weeks 3–6.**

- Start cold volume.
- Do the reports by hand in a spreadsheet.
- Make offers only where the report shows 10× the fee.

**Weeks 5–8.** Build features 1–2 from real files.

**Weeks 9–12.**

- Onboard the founding customers.
- Pitch one state association.
- Collect testimonials at 30 days.

| Gate                           | By day 45   | By day 90   |
| ------------------------------ | ----------- | ----------- |
| Reports delivered              | 15          | 40          |
| Paid hospitals                 | 3           | 10          |
| Median money found per report  | 10× the fee | 10× the fee |
| Referrals or association intro | 1           | 3           |

**Stop or change the plan if:**

- At day 45, fewer than 8 hospitals will share files. The trust or data
  barrier is too high.
- The reports find under 10× the fee. The leak is too small.
- Most prospects say their HMS already does this well.
- In each case, switch to the service-exporter fallback: a forex and export
  ledger timed to the FEMA export rules that start on 1 October 2026
  ([LKS](https://www.lkslaw.com/insights/articles/rbi-releases-fema-2026-export-import-trade-regulations-what-businesses-need-to-know)).

**Ads.** Run no ads until 10 paying hospitals and one case study exist. Then
test Google Search on intent terms such as "TPA claim management software"
and "hospital TPA reconciliation". Start at ₹1,000–3,000 a day.

## Second market: decide on 15 December 2026

The UAE makes e-invoicing mandatory for businesses with revenue under AED 50
million. They must appoint an accredited service provider (ASP) by 31 March
2027 and go live on 1 July 2027
([UAE Ministry of Finance](https://mof.gov.ae/en/news/ministry-of-finance-announces-targeted-amendments-to-einvoicing-system-decisions/)).
The rule covers all B2B businesses, and Indian-owned firms lead new Dubai
Chamber memberships. It is a forced switching moment.

- **The barriers:**
  - You cannot become an ASP; that needs 2 years of Peppol operations and UAE
    hosting.
  - Tally, Zoho and ClearTax are already ASPs
    ([ASP list](https://mof.gov.ae/en/about-us/initiatives/einvoicing/einvoicing-accredited-service-providers-asps/)).
- **Pursue it only if:**
  - The hospital bet has 5 or more paying customers.
  - An ASP will give you an API partnership.
- **A better adjacent path:** Indian-owned clinics in the UAE also bill
  insurers. The payer ledger could travel there before general UAE
  accounting does.

## What this does not prove

- The public news proves scheme dues and payer disputes.
- Vendor pages prove competition exists.
- Nothing here proves that hospitals will share files, that the leak is 10×
  the fee, or that they will pay you instead of their HMS vendor.
- The first 15 Payer Leak Reports are the evidence gate.
