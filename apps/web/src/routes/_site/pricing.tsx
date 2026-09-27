import { Link, createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { CtaBand } from "@/components/landing/cta-band";
import { FaqList } from "@/components/landing/faq-list";
import { LabelSection } from "@/components/landing/label-section";
import { PageHero } from "@/components/landing/page-hero";
import { PlanCard } from "@/components/landing/plan-card";
import { PLANS } from "@/components/landing/plans";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/_site/pricing")({
  head: () => pageHead({ path: "/pricing" }),
  component: PricingPage,
});

const YES = "Yes";

/* Included in the plan: printed in stamp colour, like a tick. */
const INCLUDED = new Set<ReactNode>([YES, "Free", "Included"]);

/* Starter, Business, Growth. */
const COMPARE: [string, ReactNode, ReactNode, ReactNode][] = [
  [
    "GSTINs",
    "1",
    "1",
    <>
      Up to <span className="fill">[5]</span>
    </>,
  ],
  ["Users", "2", "5", "15"],
  ["CA and CA staff logins", "Free", "Free", "Free"],
  ["GST invoices, credit notes", YES, YES, YES],
  ["e-invoice and e-way bill", "—", YES, YES],
  ["Bank reconciliation", "—", YES, YES],
  ["GSTR-2B matching", "—", YES, YES],
  ["Branches and approvals", "—", "—", YES],
  ["Switch from Tally, done with you", "Included", "Included", "Included"],
  ["Phone and WhatsApp support", YES, YES, YES],
];

const FAQ = [
  {
    q: "Is there a discount for paying yearly?",
    a: (
      <>
        <span className="fill">[Yearly price: to be set.]</span> You’ll get a GST invoice for
        whichever you choose, so you can claim the input credit.
      </>
    ),
  },
  {
    q: "What happens when early access ends?",
    a: "We email and WhatsApp you a month before. If you don’t pick a plan, your books stay readable and exportable; nothing is deleted.",
  },
  {
    q: "Can I leave and take my data?",
    a: (
      <>
        Yes, at any time. Export every ledger and voucher to Excel, or ask us for a full export. See
        our{" "}
        <a href="https://edernal.com/refunds.html" className="underline underline-offset-3">
          refund policy
        </a>
        .
      </>
    ),
  },
];

function PricingPage() {
  return (
    <>
      <PageHero kicker="Pricing" title="One price per business, in rupees.">
        Free during early access. Prices below are yearly, plus 18% GST, and{" "}
        <b>
          the price you join at is kept for <span className="fill">[2 years]</span>.
        </b>
      </PageHero>

      <section aria-label="Plans" className="wrap pb-[clamp(56px,7vw,96px)]">
        <div className="grid gap-4 min-[901px]:grid-cols-3">
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.name}
              name={plan.name}
              forWhom={plan.forWhom}
              price={plan.price}
              badge={plan.badge}
              features={plan.features}
            >
              <Link to="/early-access" className={plan.badge ? "btn" : "btn line"}>
                Get early access
              </Link>
            </PlanCard>
          ))}
        </div>
      </section>

      <LabelSection label="Compare plans">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[15px] [&_td]:border-b [&_td]:border-(--line) [&_td]:px-3 [&_td]:py-3.25 [&_th]:border-b [&_th]:border-(--line) [&_th]:px-3 [&_th]:py-3.25">
            <thead className="text-sm font-semibold">
              <tr>
                <th>
                  <span className="sr-only">Feature</span>
                </th>
                <th>Starter</th>
                <th>Business</th>
                <th>Growth</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE.map(([feature, ...plans]) => (
                <tr key={feature}>
                  <td className="min-w-45 text-(--ink-muted)">{feature}</td>
                  {plans.map((value, i) => (
                    <td
                      // oxlint-disable-next-line react/no-array-index-key -- fixed plan columns
                      key={i}
                      className={
                        INCLUDED.has(value) ? "font-medium text-(--stamp)" : "text-(--ink-2)"
                      }
                    >
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </LabelSection>

      <LabelSection label="Questions">
        <FaqList items={FAQ} />
      </LabelSection>

      <CtaBand />
    </>
  );
}
