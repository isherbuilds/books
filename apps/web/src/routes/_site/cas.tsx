import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";

import { CtaBand } from "@/components/landing/cta-band";
import { FaqList } from "@/components/landing/faq-list";
import { LabelSection } from "@/components/landing/label-section";
import { PageHero } from "@/components/landing/page-hero";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/_site/cas")({
  head: () => pageHead({ path: "/cas" }),
  component: CasPage,
});

const GETS = [
  {
    title: "One login, every client",
    body: "Switch between clients from one account. Each business decides what you can see and whether you can post entries.",
  },
  {
    title: "GST figures you can file from",
    body: "GSTR-1 and GSTR-3B summaries each month, with purchase bills matched to GSTR-2B and mismatches listed by supplier.",
  },
  {
    title: "An audit trail you can trust",
    body: "Every entry, edit and deletion is kept with who made it and when. Closed periods stay closed unless you reopen them.",
  },
  {
    title: "Exports in the shape you use",
    body: "Trial balance, ledgers, day book and schedules to Excel, laid out the way your working papers expect.",
  },
  {
    title: "Year-end, done in the books",
    body: "Adjustment entries, depreciation and closing stock posted in Books, then the new year opened with balances carried forward.",
  },
  {
    title: "Fewer client calls",
    body: "Outstanding, bank matching and unposted bills are visible to you, so you can see what’s missing before asking.",
  },
];

const PARTNER = [
  { term: "Free", detail: "CA login, on every client’s plan" },
  { term: <span className="fill">[Terms]</span>, detail: "Partner benefits, to be announced" },
  { term: "Named contact", detail: "One person at Edernal for your firm" },
  { term: "Early say", detail: "Monthly call on what we build next" },
];

const FAQ = [
  {
    q: "Do I pay anything?",
    a: "No. The business pays for its plan; logins for its CA and the CA’s staff are included.",
  },
  {
    q: "Can my articles and staff get access too?",
    a: "Yes. Add people from your firm and choose, per client, whether they can view or also post entries.",
  },
  {
    q: "Can I bring clients who use Tally today?",
    a: (
      <>
        Yes. We handle the move for them, and you check the trial balance before they start. See{" "}
        <Link to="/tally" className="underline underline-offset-3">
          how switching works
        </Link>
        .
      </>
    ),
  },
  {
    q: "Can Books file returns for me?",
    a: (
      <>
        <span className="fill">[Direct GSTN filing: confirm scope before launch.]</span> The figures
        and JSON are ready either way.
      </>
    ),
  },
];

function CasPage() {
  return (
    <>
      <PageHero
        kicker="For CAs and accounting firms"
        title="Your clients’ books, without chasing exports."
        actions={
          <Link to="/early-access" className="btn">
            Talk to us about your practice <ArrowRightIcon />
          </Link>
        }
      >
        When a client keeps their books in Edernal Books, you open them yourself: ledgers, trial
        balance and GST figures, current to the day. <b>A CA login is free on every plan.</b>
      </PageHero>

      <LabelSection label="What you get">
        <div className="grid gap-x-8 gap-y-10 min-[761px]:grid-cols-2">
          {GETS.map((item) => (
            <div key={item.title} className="reveal">
              <h3 className="mb-2 font-semibold">{item.title}</h3>
              <p className="text-[15.5px] leading-[1.65] text-(--ink-muted)">{item.body}</p>
            </div>
          ))}
        </div>
      </LabelSection>

      <LabelSection label="Partner firms">
        <p className="max-w-[34em] text-[clamp(20px,2vw,24px)] leading-normal font-[450] tracking-[-0.012em]">
          We’re looking for a few CA firms to shape Books with us.{" "}
          <span className="text-(--ink-muted)">
            You tell us what your clients get wrong; we fix it in the product and help move your
            clients across from Tally.
          </span>
        </p>
        <dl className="mt-10 grid gap-x-8 min-[761px]:grid-cols-2">
          {PARTNER.map((item) => (
            <div
              key={item.detail}
              className="reveal grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 border-t border-(--line) py-3.5"
            >
              <dt className="text-[clamp(17px,1.6vw,20px)] font-[550] tracking-[-0.01em] whitespace-nowrap">
                {item.term}
              </dt>
              <dd className="text-right text-[14.5px] text-(--ink-muted)">{item.detail}</dd>
            </div>
          ))}
        </dl>
      </LabelSection>

      <LabelSection label="Questions">
        <FaqList items={FAQ} />
      </LabelSection>

      <CtaBand />
    </>
  );
}
