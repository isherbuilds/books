# Accounting app: market and first offer

Researched 27 September 2026. This is a recommendation for a test, not approved product or public copy. No prospect was contacted. The working tree already contains concurrent marketing and product edits; this note does not change them.

## Question

Who should buy the accounting app first, what should the offer be, and how should it reach them?

## Answer

**Test an assisted, CA-approved month-end pilot with owner-run Indian service businesses that invoice regularly, have little or no stock, and use an external CA.** The owner buys, the owner or bookkeeper enters records, and the CA can veto a switch. Lead with one shared, explainable view of invoices, receipts, dues, and reports. The first result is a reconciled opening position and a close the CA accepts. This is a hypothesis, not a validated demand claim. [Product](../product.md#position) says external demand is unproved; [launch research](./launch-and-homepage-2026-09-26.md#first-customer) names this cohort as a test.

Do not market the current broad three-tier offer as the first commercial offer. The draft page sells traders, bank matching, GSTR-2B checks, e-invoicing, branches, several GSTINs, and a full Tally switch. Those claims exceed the [live scope](../product.md#scope) and conflict with the [pilot cutover rule](../product.md#delivery-rules). They weaken perceived likelihood of success, the most important weak point in the [value-equation exercise](https://github.com/zacker-tech/hormozi-skills/blob/main/skills/value-equation/SKILL.md). Evidence: [plans](../../apps/web/src/components/landing/plans.tsx), [pricing page](../../apps/web/src/routes/_site/pricing.tsx), and [homepage](../../apps/web/src/routes/_site/index.tsx).

## Method

I reviewed the 10 skills in [zacker-tech/hormozi-skills](https://github.com/zacker-tech/hormozi-skills/tree/main/skills) and the 18 in [alexsmedile/hormozi-skills](https://github.com/alexsmedile/hormozi-skills/tree/main/skills). I applied niche selection, market research, the value equation, offer construction and audit, pricing, the Core Four channels, outreach, lead magnet, objections, and pitch. I did not run `create-plugin`: it scaffolds software rather than testing this business idea. The two collections are frameworks, not evidence that this market wants the product.

## Market choice

| Candidate                                   | Pain and buyer                                                                                                        | Product fit now                                                                                                                | Reach and test                                                            | Decision                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Owner-run service business with external CA | The owner may lose track of dues; the CA may rebuild or question records. Both are hypotheses to observe.             | Invoices, receipts, allocations, party ledger, journals, locks, and GST registers exist, subject to runtime and CA acceptance. | Recruit owners through their CAs and observe a recent month.              | **First test.**                                                                         |
| Owner with several legal entities           | One login and per-owner price may matter, but the buyer needs a clear benefit beyond avoiding multiple subscriptions. | Multi-organization access exists; consolidation does not.                                                                      | The founder's three entities can prove workflow fit, not external demand. | Use as a subsegment after one-entity close succeeds.                                    |
| CA firm as buyer                            | Re-entry and client handoffs may consume staff time.                                                                  | A shared client login exists; the cross-client CA workspace is a future bet.                                                   | Five-firm interview gate already exists.                                  | Keep as an alternate offer if firms reject shared books but show material handoff pain. |
| Trader, distributor, or hospital            | Possible larger budgets, but stock, operational billing, and e-invoicing may be mandatory.                            | Inventory and e-invoicing are evidence-gated; hospital operations live outside this repo.                                      | A demo may conceal a hard workflow gap.                                   | Exclude from the first offer.                                                           |

This is a qualitative comparison, not a numerical market score. Purchasing power, urgency, growth, and reach have not been measured. The [customer evidence](./customer-evidence-2026-09-26.md) contains isolated complaints and counterevidence, not buying commitments. The [CA interview plan](../validation/ca-interviews.md) currently samples firms with clients in a ₹2–50 crore band. That sample can test a CA channel, but it does not validate this narrower first customer by itself.

## Value equation and offer audit

The [Grand Slam Offer](https://github.com/zacker-tech/hormozi-skills/blob/main/skills/grand-slam-offer/SKILL.md), [offer audit](https://github.com/alexsmedile/hormozi-skills/blob/main/skills/audit-offer/SKILL.md), and [market research](https://github.com/alexsmedile/hormozi-skills/blob/main/skills/market-research/SKILL.md) exercises give this diagnosis:

| Driver          | Current state                                                                                     | Offer response                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Desired outcome | "Accounting and GST" is broad. "Get paid sooner" and "never lose input credit" are unproved.      | Promise visibility into what is owed and a CA-accepted month-end, then measure any time or cash result.                                                                  |
| Likelihood      | No external paid case study or accepted close is recorded. Draft claims run ahead of the product. | Show a real invoice → partial receipt → outstanding balance → source ledger, then a CA-reviewed trial balance. Publish a case only with permission and measured results. |
| Time to value   | Migration and a full close take time. Automatic history import is absent.                         | Start with a short walkthrough of the buyer's last month and a narrow, reconciled opening position. State the cutover scope before asking them to switch.                |
| Effort          | The owner and CA must learn a new workflow and trust the opening balances.                        | Founder-led setup and one guided close. Record founder hours to check whether the service can be sustained at the proposed price.                                        |

The strongest objection is **"My CA will not accept a new set of books."** Answer it with the CA in the evaluation, a reconciled opening position, and a close the CA signs off. If the CA prefers exports and continues in Tally, a free CA login is not a solution. The second objection is migration risk: specify that the pilot moves masters and opening balances, not historic invoices. The third is feature gaps: screen for bank feeds, inventory, e-invoicing, and return filing before enrollment. See the [pilot cutover rule](../product.md#delivery-rules) and [scope](../product.md#scope).

## Proposed first offer

**Working name:** CA-ready books pilot.

**Who:** An owner-run Indian service business with regular invoicing, little or no stock, and an external CA willing to review a pilot. Screen for statutory and workflow needs that the product cannot yet serve.

**Outcome:** The owner can see recorded dues and the CA can review the same underlying documents and ledger at the first month-end. The opening and closing balances reconcile, or the pilot records the gap and stops. This is a proposed acceptance condition, not a promise of tax filing or faster collection.

**Delivery:** One guided discovery call with owner and CA; scope and reconcile masters and opening balances; train the operator on invoice and receipt entry; review one month-end together; give the owner and CA their reports and a written gap list. Confirm report readiness and CA acceptance before selling this as live delivery. [Product scope](../product.md#scope) and [pilot readiness](../README.md#work-lifecycle) own that gate.

**Risk reduction:** Keep the incumbent books available during evaluation. Agree on opening balances and acceptance criteria before cutover. Do not promise an automatic Tally history import, a 30-day refund, a response time, or an unconditional outcome until the business can deliver those terms. A guarantee based on an untested service creates another trust problem. [Product delivery rules](../product.md#delivery-rules); [current draft claims](./launch-and-homepage-2026-09-26.md#the-claude-design-artifact).

**Offer line for a private test:** "Know what customers still owe, and give your CA the same books to review. We will set up a guided pilot, reconcile the opening balances with you, and review the first month-end together. Bring your CA to the walkthrough."

This is a guided software pilot, not a promise to perform bookkeeping or file returns. It is deliberately one offer for one buyer. [Zoho Books India](https://www.zoho.com/in/books/pricing/) already lists banking, reconciliation, period locks, GST filing, reports, and accountant access in its Standard tier; feature-list comparison alone is weak positioning.

## Price hypothesis

Keep **one owner subscription across organizations** as the product direction. Do not infer willingness to pay from a competitor's list price. Zoho Standard is currently listed at ₹749 per organization per month billed annually, excluding local taxes; three organizations therefore list at ₹26,964 a year before tax. A single organization can also use Zoho's free plan if its limits fit. [Zoho pricing](https://www.zoho.com/in/books/pricing/); [Product position](../product.md#position).

Test a quoted annual price only after the buyer has seen the close and the founder has measured setup and support hours. The prior research's ₹7,499 founding and ₹14,999 list prices are **untested hypotheses**, not a public price or an approved discount. Ask for a paid continuation or a dated purchase commitment at a specific quoted price; "I would pay" is weak evidence. Log the offer, entities, users, migration scope, support hours, objections, and outcome for each buyer. [Launch research](./launch-and-homepage-2026-09-26.md#launch-plan); [pricing-strategy skill](https://github.com/alexsmedile/hormozi-skills/blob/main/skills/pricing-strategy/SKILL.md).

## Marketing and sales path

Use one channel first: **CA-assisted, one-to-one introductions to owners**, starting with the founder's existing CA relationship and then referrals. This fits the [Core Four](https://github.com/zacker-tech/hormozi-skills/blob/main/skills/core-four/SKILL.md) and [warm outreach](https://github.com/zacker-tech/hormozi-skills/blob/main/skills/warm-outreach/SKILL.md) exercises. Do not buy ads before the offer and close work on a few real customers. A landing page can explain the pilot and collect qualified walkthrough requests; it does not replace the CA decision.

1. **Discovery:** Run the existing [five-firm CA interviews](../validation/ca-interviews.md) and observe one recent month-end at each firm where possible. Also observe owners in the narrower service segment. Ask to see the actual last invoice, partial receipt, overdue balance, report handoff, and correction. Record what their current tool already does well.
2. **Free, narrow diagnostic:** With permission, walk one owner and CA through a recent redacted invoice, receipt, and outstanding balance. Return a one-page source-to-balance map and any unresolved question. This solves a small trust problem before pitching a system switch. It is a proposed [lead magnet](https://github.com/zacker-tech/hormozi-skills/blob/main/skills/lead-magnet/SKILL.md), not an advertised free audit until capacity and data handling are set.
3. **Walkthrough:** Demonstrate the same chain in Books, then show the CA's review and export. Ask for a named pilot date, a named operator and CA, and the actual cutover requirements.
4. **Pilot:** Track cutover reconciliation, time to first recorded invoice and receipt, close acceptance, founder support hours, and a paid continuation. Ask each successful CA for one introduction only after their own pilot works.

**Referral request draft, for the founder to send if appropriate:** "You work with owners who send records back and forth each month. I am testing a shared books workflow for service firms with an external CA. Could I watch one recent month-end handoff with client details hidden? If it fits, I can show you the same invoice-to-balance trail in a short walkthrough." This asks for evidence, not an endorsement.

**Owner page draft:** Headline: "Know what is owed. Give your CA the same books to review." Support: "Record invoices and receipts in one place. See each unpaid balance and the entries behind it. Join a guided pilot with your CA." CTA: "Book a walkthrough with your CA." This is draft copy for a test, not approval to replace the selected public site. [Current site decision](./launch-and-homepage-2026-09-26.md#decisions).

## What this proves and does not prove

The repository proves the intended product, implementation scope, and founder's pilot plan. The competitor's official price page proves a current listed price and features, not buyer satisfaction. The two skill repositories provide useful offer and channel questions, not market evidence. No source here proves that owners will switch, that CAs will endorse the tool, that the close saves time, or that the proposed price will clear. [Product](../product.md#position); [customer evidence](./customer-evidence-2026-09-26.md); [Zoho pricing](https://www.zoho.com/in/books/pricing/).

## Next falsification

- Keep the current [CA gate](../validation/ca-interviews.md): three of five firms schedule a dated trial with a named client; zero or one stops the shared-workspace bet. Check the four-hour handoff threshold and whether firms prefer a CA-only tool.
- Add owner-level proof in the service segment: observe actual recent records, qualify feature needs, and ask for a pilot date with the CA present. Do not count a compliment or email signup as a buying commitment.
- Complete and measure two successive CA-accepted closes before claiming a repeatable result. Record founder hours and ask for paid continuation at a quoted price. [Launch research](./launch-and-homepage-2026-09-26.md#launch-plan).
- If the CA requires Tally and wants exports, test a CA-led handoff service instead. If the first owners need inventory, e-invoicing, or bank automation, narrow the segment or change the product bet; do not hide the gaps in copy. [Product scope](../product.md#scope).

## Sources

- [Accly Books product position and scope](../product.md)
- [Accounting core](../specs/accounting-core.md)
- [CA interview gate](../validation/ca-interviews.md)
- [Previous launch and customer evidence](./launch-and-homepage-2026-09-26.md)
- [Zacker skill collection](https://github.com/zacker-tech/hormozi-skills/tree/main/skills)
- [Alex Smedile skill collection](https://github.com/alexsmedile/hormozi-skills/tree/main/skills)
- [Zoho Books India pricing](https://www.zoho.com/in/books/pricing/)
