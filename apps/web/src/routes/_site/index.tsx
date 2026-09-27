import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Calculator } from "@/components/landing/calculator";
import { CallbackForm } from "@/components/landing/callback-form";
import { FaqList } from "@/components/landing/faq-list";
import { withFills } from "@/components/landing/fill";
import { HeroScene } from "@/components/landing/hero-scene";
import { Person } from "@/components/landing/person";
import { PlanCard } from "@/components/landing/plan-card";
import { PLANS } from "@/components/landing/plans";
import { SectionHead } from "@/components/landing/section-head";
import { Ticks } from "@/components/landing/ticks";
import { WaIcon } from "@/components/landing/wa-icon";
import { FAQS } from "@/content/faqs";
import { WHATSAPP_URL } from "@/lib/contact";
import { redirectSignedInHome } from "@/lib/home";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/_site/")({
  // A signed-in visitor never sees the marketing page; the redirect happens on the
  // server so there is no flash. Crawlers carry no cookie and still get the page.
  beforeLoad: () => redirectSignedInHome(),
  head: () => pageHead({ path: "/" }),
  component: HomePage,
});

const SEC = "py-[clamp(72px,9vw,120px)]";

const ALT = `${SEC} border-y border-(--line) bg-(--surface)`;

const KEEP_HEAD = "mb-[clamp(36px,5vw,52px)]";

const PAINS = [
  {
    q: "My accountant is on leave, and I have no idea who owes me what.",
    fix: "Owed, owe and bank on your phone. Every party, every bill, by age.",
  },
  {
    q: "My CA wants the Tally backup on a pen drive. Again.",
    fix: "Your CA gets a free login to your live books. Nothing to copy.",
  },
  {
    q: "A supplier didn’t file GSTR-1, and ₹20,160 of input credit got stuck.",
    fix: "Every bill is checked against GSTR-2B. You know whom to call before you file.",
  },
  {
    q: "GST rates changed and half my bills went out at the old rate.",
    fix: "Rates and HSN are kept current for you. Every invoice is checked before it goes.",
  },
];

const RULES = [
  {
    when: "From July 2025",
    title: "GSTR-3B sales are locked",
    body: "Table 3 comes from GSTR-1 and can’t be edited.",
    books: "Books checks each invoice before it reaches GSTR-1.",
  },
  {
    when: "From August 2025",
    title: "Three-year limit on returns",
    body: "Returns more than three years past due can no longer be filed.",
    books: "Books shows every pending return in one place.",
  },
  {
    when: "Every month",
    title: "Credit only if it’s in 2B",
    body: "Your input credit depends on your supplier’s filing.",
    books: "Books lists what’s missing, by supplier, before you file.",
  },
  {
    when: "From 22 September 2025",
    title: "New GST rates",
    body: "Most goods moved to 5% or 18%.",
    books: "Rates and HSN are kept current for you.",
  },
  {
    when: "Turnover over ₹5 crore",
    title: "e-invoicing",
    body: "Over ₹10 crore, invoices must reach the IRP within 30 days.",
    books: "Books gets the IRN when you save the invoice.",
  },
  {
    when: "Income tax, every 31 March",
    title: "Pay MSMEs within 45 days",
    body: "Unpaid dues to micro and small suppliers past the limit can’t be claimed as expenses.",
    books: "Books flags them before year-end.",
  },
];

const TALLY: [string, string][] = [
  ["Licence (Silver, one computer)", "₹22,500 + GST, once"],
  ["Yearly renewal for GST updates, banking and remote access", "₹4,500 + GST"],
  ["Your CA sees your books", "Backup on a pen drive"],
  ["Backups", "Your job"],
  ["Works offline", "Yes"],
];

const BOOKS: [string, ReactNode][] = [
  ["Business plan", "₹9,999 + GST a year"],
  ["GST updates, bank matching, phone access", "Included"],
  ["Your CA sees your books", "Free login, live"],
  ["Backups", "Daily, automatic, in India"],
  ["Works offline", <span className="fill">[confirm]</span>],
];

const STEPS = [
  {
    when: "Day 1 · 30-minute call",
    title: "We see how you work",
    body: "And export one file from Tally together.",
  },
  {
    when: "Day 2 · we do it",
    title: "We move it across",
    body: "Ledgers, parties with GSTIN, balances, vouchers.",
  },
  {
    when: "Day 3 · about an hour",
    title: "You check the balance",
    body: "Tally and Books trial balances, group by group.",
  },
  {
    when: "Day 4",
    title: "You bill in Books",
    body: "We stay on WhatsApp through your first month-end.",
  },
];

/* Placeholder tones for the people, until real photos replace them. */
const SAGE = ["#D8DCD2", "#9FAA96", "#46503F"] as const;

const TEAM: {
  name: string;
  role: string;
  photo: string;
  width: number;
  tilt: number;
  tones?: readonly [string, string, string];
}[] = [
  {
    name: "[Founder name]",
    role: "Builds Books",
    photo: "Placeholder for founder photo",
    width: 140,
    tilt: -4,
  },
  {
    name: "[Name]",
    role: "Does your Tally switch",
    photo: "Placeholder for onboarding lead photo",
    width: 124,
    tilt: 3,
    tones: ["#E4DCEF", "#B79CD2", "#4E2F6B"],
  },
  {
    name: "[Name], CA",
    role: "Checks every balance",
    photo: "Placeholder for accounts lead photo",
    width: 114,
    tilt: -2,
    tones: SAGE,
  },
];

const SOURCE = "underline underline-offset-2";

function HomePage() {
  return (
    <>
      <section className="overflow-x-clip pt-[clamp(44px,6vw,84px)] pb-[clamp(48px,6vw,88px)]">
        <div className="wrap grid items-center gap-[clamp(32px,5vw,64px)] min-[981px]:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          <div>
            <h1 className="text-[clamp(42px,5.8vw,78px)] leading-none font-[620] tracking-[-0.045em]">
              Get paid sooner.{" "}
              <span className="block text-(--stamp)">Never lose input credit.</span>
            </h1>
            <p className="rise mt-5.5 max-w-[33em] text-[clamp(17px,1.45vw,19.5px)] leading-[1.6] text-(--ink-muted) [--d:80ms]">
              Billing, payments, bank matching and GST in one place, on your phone and your
              accountant’s computer, with a{" "}
              <b className="font-[550] text-(--ink)">free login for your CA</b>. We move your books
              from Tally for you.
            </p>
            <div className="rise mt-7.5 flex flex-wrap gap-3 [--d:160ms]">
              <a className="btn" href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
                <WaIcon />
                Chat on WhatsApp
              </a>
              <Link to="/" hash="calc" className="btn line">
                See how much you’re owed <ArrowRightIcon />
              </Link>
            </div>
            <p className="rise mt-3.5 flex items-center gap-2 text-sm text-(--ink-muted) [--d:240ms]">
              <i
                aria-hidden
                className="size-2 flex-none rounded-full bg-(--ok) shadow-[0_0_0_3px_color-mix(in_srgb,var(--ok)_18%,transparent)]"
              />
              Replies in 5 minutes · Free switch from Tally · 30-day refund
            </p>
          </div>
          <HeroScene />
        </div>
      </section>

      <section className={ALT} aria-labelledby="pain-h">
        <div className="wrap">
          <SectionHead
            id="pain-h"
            title="Four problems we hear from almost every owner."
            className={KEEP_HEAD}
          />
          <div className="grid gap-3.5 min-[561px]:grid-cols-2 min-[1001px]:grid-cols-4">
            {PAINS.map((pain) => (
              <div
                key={pain.q}
                className="reveal flex flex-col gap-3.5 rounded-[18px] bg-(--paper) p-5.5 ring-1 ring-(--line)"
              >
                <q className="text-lg leading-[1.4] font-[550] tracking-[-0.01em]">{pain.q}</q>
                <p className="mt-auto border-t border-(--line) pt-3.5 text-[14.5px] leading-normal text-(--ink-muted)">
                  <b className="mb-1 block text-xs tracking-[0.07em] text-(--stamp) uppercase">
                    With Books
                  </b>
                  {pain.fix}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="calc" className={SEC} aria-labelledby="calc-h">
        <div className="wrap">
          <SectionHead
            id="calc-h"
            title="How much of your money is sitting with customers?"
            className={KEEP_HEAD}
          >
            Move the sliders to match your business. Nothing is saved or sent.
          </SectionHead>
          <Calculator />
        </div>
      </section>

      <section id="outcomes" className={ALT} aria-labelledby="out-h">
        <div className="wrap">
          <SectionHead
            id="out-h"
            title="Money in faster. GST right the first time. A CA who stops chasing you."
            className={KEEP_HEAD}
          />
          <div className="flex flex-col gap-[clamp(64px,8vw,104px)]">
            <Outcome
              title="A call list, not a report."
              body="Every morning Books lists who to call, how much, and since when. One tap opens WhatsApp with the bill and your UPI details, ready to send. Record the receipt and the bill is settled."
              ticks={[
                "Ageing by 30, 60, 90 days, party by party",
                "Part payments and TDS handled",
                "MSME suppliers you must pay within 45 days, flagged",
              ]}
            >
              <Card title="You’re owed" meta="₹18,42,600 · 41 parties">
                <div className="flex flex-col gap-2.75">
                  <AgeBar span="0–30 days" width="100%" amount="₹11,24,800" />
                  <AgeBar span="31–60 days" width="36%" amount="₹4,01,400" />
                  <AgeBar span="61–90 days" width="19%" amount="₹2,16,400" ink />
                  <AgeBar span="Over 90" width="9%" amount="₹1,00,000" ink />
                </div>
              </Card>
              <Card title="Suppliers to pay this week" meta="MSME 45-day rule">
                <Line
                  label="Mahaveer Packaging · Micro"
                  pill={<span className="pill w">Day 41 of 45</span>}
                  note="₹38,500 · pay by 30/09 to keep the expense deductible"
                />
                <Line
                  label="Shree Cement Ltd"
                  pill={<span className="pill s">Not MSME</span>}
                  note="₹1,12,000 · due 10/10"
                />
              </Card>
            </Outcome>

            <Outcome
              flip
              title="File knowing the numbers are right."
              body="Since July 2025, GSTR-3B takes your sales straight from GSTR-1 and you can’t edit them. Books checks every invoice as you bill, and every purchase against GSTR-2B, so problems show up before you file, not after."
              ticks={[
                "GSTR-1 and 3B figures ready as you bill",
                "Input credit matched to 2B, mismatches by supplier",
                "e-invoice and e-way bill from the invoice",
              ]}
            >
              <Card title="GSTR-3B · September 2026" meta="due 20/10/2026">
                <Sum
                  rows={[
                    ["Output tax on sales", "3,48,200.00"],
                    ["Less: input credit in 2B", "(2,23,820.00)"],
                  ]}
                  total={["Tax to pay", "₹1,24,380.00"]}
                />
              </Card>
              <Card title="Not in your 2B yet" meta="₹24,480 of credit at risk">
                <Line
                  label="Shree Cement Ltd · B-2291"
                  pill={<span className="pill w">₹20,160</span>}
                  note="Supplier hasn’t filed GSTR-1 for September. Call before the 11th."
                />
                <Line
                  label="Mahaveer Packaging · 1187"
                  pill={<span className="pill w">₹4,320</span>}
                  note="Your GSTIN is wrong on their bill. Ask for a corrected invoice."
                />
              </Card>
            </Outcome>

            <Outcome
              title="Your CA opens your books, not your inbox."
              body="Invite your CA with their own free login. They see the ledgers, trial balance and GST figures as they are today, leave notes on entries, and every change is on record."
              ticks={[
                "Free for your CA and their staff",
                "You decide: view only, or can post entries",
                "Excel exports in the format they already use",
              ]}
            >
              <Card title="Note from your CA" meta="on JV-0412 · 24/09">
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4">
                  <Person
                    label="Placeholder for a CA's cut-out photo"
                    width={72}
                    tilt={-4}
                    tones={SAGE}
                  />
                  <p className="text-sm text-(--ink-muted)">
                    <b className="text-(--ink)">R. K. Jain, CA</b>{" "}
                    <span className="fill text-[11px]">[placeholder]</span>
                    <br />
                    “Rent for September is booked twice. I’ve reversed one; please check against the
                    landlord’s receipt.”
                  </p>
                </div>
              </Card>
              <Card title="Trial balance · 31/08/2026" meta="live">
                <Sum
                  rows={[
                    ["Total debit", "43,32,200.00"],
                    ["Total credit", "43,32,200.00"],
                  ]}
                  total={["Difference", "0.00"]}
                />
              </Card>
            </Outcome>
          </div>
        </div>
      </section>

      <section className={SEC} aria-labelledby="rules-h">
        <div className="wrap">
          <SectionHead
            id="rules-h"
            title="Rules that changed since 2025, and what Books does about each."
            className={KEEP_HEAD}
          />
          <div className="grid gap-x-7 min-[561px]:grid-cols-2 min-[901px]:grid-cols-3">
            {RULES.map((rule) => (
              <div
                key={rule.title}
                className="reveal flex flex-col gap-2 border-t border-(--line) py-5.5"
              >
                <span className="text-[12.5px] font-semibold tracking-[0.02em] text-(--warn) tabular-nums">
                  {rule.when}
                </span>
                <h3 className="text-[17px] font-[620] tracking-[-0.01em]">{rule.title}</h3>
                <p className="text-[14.5px] leading-[1.55] text-(--ink-muted)">
                  {rule.body} <b className="font-[550] text-(--ink)">{rule.books}</b>
                </p>
              </div>
            ))}
          </div>
          <p className="mt-5 text-[12.5px] leading-[1.6] text-(--faint)">
            Summaries only, not tax advice; check with your CA. Sources:{" "}
            <a
              className={SOURCE}
              href="https://cleartax.in/s/gst-return-filing-rule-changes-from-july-2025"
            >
              ClearTax on the July 2025 changes
            </a>{" "}
            ·{" "}
            <a
              className={SOURCE}
              href="https://www.gimbooks.com/blog/5-crore-e-invoice-turnover-rule-2026/"
            >
              e-invoice threshold
            </a>{" "}
            ·{" "}
            <a className={SOURCE} href="https://razorpay.com/learn/gst-2-0-reforms-in-india/">
              GST 2.0 rates
            </a>{" "}
            ·{" "}
            <a
              className={SOURCE}
              href="https://taxupdate.in/income-tax/893/section-43bh-msme-payment-disallowance-tax-audit-2026-section-37-income-tax-act-2025/"
            >
              MSME 45-day rule
            </a>
          </p>
        </div>
      </section>

      <section id="tally" className={ALT} aria-labelledby="tally-h">
        <div className="wrap">
          <SectionHead
            id="tally-h"
            title="Leave Tally without losing a paisa, or a weekend."
            className={KEEP_HEAD}
          >
            We move your ledgers, parties, opening balances and this year’s vouchers. Keep Tally as
            it is, in parallel, for as long as you like.
          </SectionHead>
          <div className="grid gap-4 min-[861px]:grid-cols-2">
            <Compare
              title="Tally, on one office computer"
              rows={TALLY}
              className="ring-1 ring-(--line)"
            />
            <Compare
              title="Edernal Books"
              badge="Everything included"
              rows={BOOKS}
              className="ring-2 ring-(--ink) [&_dd]:text-(--stamp) [&_dl>div:first-child_dd]:text-(--ink)"
            />
          </div>
          <ol className="mt-7 grid grid-cols-2 gap-5 min-[861px]:grid-cols-4">
            {STEPS.map((step, i) => (
              <li
                key={step.title}
                className={`reveal relative flex flex-col gap-1.5 ${
                  i === STEPS.length - 1 ? "pt-5.5" : "border-t-[1.5px] border-(--ink) pt-4"
                }`}
              >
                {i === STEPS.length - 1 ? (
                  <span
                    aria-hidden
                    className="dbl draw absolute inset-x-0 top-0 h-2 text-(--ink)"
                  />
                ) : null}
                <small className="text-[12.5px] font-semibold text-(--faint) tabular-nums">
                  {step.when}
                </small>
                <b className="text-base font-[620]">{step.title}</b>
                <span className="text-[14.5px] leading-normal text-(--ink-muted)">{step.body}</span>
              </li>
            ))}
          </ol>
          <p className="mt-5 text-[12.5px] leading-[1.6] text-(--faint)">
            Tally prices are reseller list prices for 2026 (
            <a
              className={SOURCE}
              href="https://www.markitsolutions.in/blogs/tally-renewal-charges-2026-guide"
            >
              source
            </a>
            ); check tallysolutions.com for current prices. Tally is good software. Books is for
            businesses that want their books off one computer.
          </p>
        </div>
      </section>

      <section id="pricing" className={SEC} aria-labelledby="price-h">
        <div className="wrap">
          <SectionHead id="price-h" title="Clear prices, in rupees." className={KEEP_HEAD}>
            Paid yearly with a GST invoice, so you can claim the input credit. Early-access
            businesses keep their price for 2 years.
          </SectionHead>
          <div className="grid gap-3.5 min-[901px]:grid-cols-3">
            {PLANS.map(({ homeCta, ...plan }) => (
              <PlanCard key={plan.name} {...plan}>
                <Link to="/early-access" className={plan.badge ? "btn" : "btn line"}>
                  {homeCta}
                </Link>
              </PlanCard>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-x-7 gap-y-2.5 text-[14.5px] text-(--ink-muted) [&_b]:font-semibold [&_b]:text-(--ink)">
            <span>
              <b>30-day money back.</b> Full refund, no questions.
            </span>
            <span>
              <b>Leave any time.</b> Export everything to Excel.
            </span>
            <span>
              <b>Free during early access.</b> A month’s notice before billing.
            </span>
          </div>
        </div>
      </section>

      <section className={ALT} aria-labelledby="ppl-h">
        <div className="wrap grid items-center gap-[clamp(28px,5vw,64px)] min-[861px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div>
            <SectionHead
              id="ppl-h"
              title={withFills("A small team in [City] that answers its own phone.")}
            >
              We built Edernal Care for hospitals first. Books comes from the same people. When you
              message us, one of us replies.
            </SectionHead>
            <ul
              aria-label="Early-access businesses (placeholders)"
              className="mt-6.5 grid grid-cols-3 gap-2.5"
            >
              {[1, 2, 3].map((n) => (
                <li
                  key={n}
                  className="flex h-13 items-center justify-center rounded-[10px] border border-dashed border-(--line-2) text-center text-[12.5px] leading-tight font-semibold text-(--ink-2)"
                >
                  [Pilot business]
                  <br />
                  [City]
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap items-end gap-5.5">
            {TEAM.map((person) => (
              <div key={person.photo} className="reveal">
                <Person
                  label={person.photo}
                  width={person.width}
                  tilt={person.tilt}
                  tones={person.tones}
                />
                <span className="mt-3.5 block text-[13.5px] font-semibold">
                  {withFills(person.name)}
                  <small className="block text-[12.5px] font-normal text-(--ink-muted)">
                    {person.role}
                  </small>
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={SEC} aria-labelledby="faq-h">
        <div className="wrap grid gap-[clamp(24px,5vw,64px)] min-[861px]:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <SectionHead id="faq-h" title="Before you switch." className="self-start">
            Don’t see yours? Ask on WhatsApp. You’ll get an answer, not a sales pitch.
          </SectionHead>
          <FaqList items={FAQS.map((item) => ({ q: item.q, a: withFills(item.a) }))} />
        </div>
      </section>

      <section id="callback" aria-labelledby="final-h" className="wrap">
        <div className="band reveal grid items-center gap-[clamp(28px,5vw,56px)] rounded-[26px] bg-(--band) p-[clamp(28px,5vw,64px)] text-(--band-ink) ring-1 ring-(--band-line) min-[861px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div>
            <h2
              id="final-h"
              className="text-[clamp(32px,4.2vw,54px)] leading-[1.04] font-[620] tracking-[-0.04em]"
            >
              Talk to us for 5 minutes. We’ll handle the rest.
            </h2>
            <p className="mt-4 text-[17px] leading-[1.6] text-(--band-muted)">
              Tell us how you keep books today. We’ll show you your own overdue list in Books and
              plan your switch from Tally, free.
            </p>
            <div aria-hidden className="dbl draw mt-6 max-w-80 text-(--band-ink)" />
          </div>
          <CallbackForm />
        </div>
      </section>
    </>
  );
}

function Outcome({
  title,
  body,
  ticks,
  flip,
  children,
}: {
  title: string;
  body: string;
  ticks: string[];
  flip?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`grid items-center gap-[clamp(28px,5vw,64px)] ${
        flip
          ? "min-[861px]:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"
          : "min-[861px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
      }`}
    >
      <div className={`reveal flex flex-col gap-3.5 ${flip ? "min-[861px]:order-2" : ""}`}>
        <h3 className="text-[clamp(26px,2.8vw,36px)] leading-[1.1] font-[620] tracking-[-0.03em]">
          {title}
        </h3>
        <p className="text-[16.5px] leading-[1.65] text-(--ink-muted)">{body}</p>
        <Ticks
          items={ticks}
          className="mt-1.5 text-[15.5px] [&>li]:border-t [&>li]:border-(--line) [&>li]:py-2.5"
        />
      </div>
      <div className="flex min-w-0 flex-col gap-3 rounded-[22px] bg-(--sunken) p-[clamp(16px,3vw,36px)]">
        {children}
      </div>
    </div>
  );
}

function Card({ title, meta, children }: { title: string; meta: string; children: ReactNode }) {
  return (
    <div className="reveal min-w-0 rounded-[14px] bg-(--surface) p-4.5 text-sm shadow-(--shadow) tabular-nums">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <b className="text-[15px] font-semibold">{title}</b>
        <span className="text-[12.5px] text-(--ink-muted)">{meta}</span>
      </div>
      {children}
    </div>
  );
}

function AgeBar({
  span,
  width,
  amount,
  ink,
}: {
  span: string;
  width: string;
  amount: string;
  ink?: boolean;
}) {
  return (
    <div className="grid grid-cols-[80px_minmax(0,1fr)_100px] items-center gap-3 text-[13px]">
      <span className="text-(--ink-muted)">{span}</span>
      <span
        className={`draw h-2.5 rounded-[3px] ${ink ? "bg-(--ink)" : "bg-(--line-2)"}`}
        style={{ width }}
      />
      <span className="text-right font-[550]">{amount}</span>
    </div>
  );
}

function Line({ label, pill, note }: { label: string; pill: ReactNode; note: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.75 border-t border-(--line) py-2.5 text-[13.5px] first:border-t-0 first:pt-0">
      <span>{label}</span>
      {pill}
      <small className="col-span-full text-xs text-(--ink-muted)">{note}</small>
    </div>
  );
}

/* Figures ruled off in ink, then a double-ruled total: a ledger summed on paper. */
function Sum({ rows, total }: { rows: [string, string][]; total: [string, string] }) {
  return (
    <table className="w-full text-sm [&_td:last-child]:text-right">
      <tbody>
        {rows.map(([label, amount], i) => {
          const rule = `border-b py-2.25 ${i === rows.length - 1 ? "border-(--ink)" : "border-(--line)"}`;

          return (
            <tr key={label}>
              <td className={rule}>{label}</td>
              <td className={rule}>{amount}</td>
            </tr>
          );
        })}
        <tr className="total">
          <td>{total[0]}</td>
          <td>{total[1]}</td>
        </tr>
      </tbody>
    </table>
  );
}

function Compare({
  title,
  badge,
  rows,
  className,
}: {
  title: string;
  badge?: string;
  rows: [string, ReactNode][];
  className: string;
}) {
  return (
    <div
      className={`reveal flex flex-col rounded-[20px] bg-(--paper) p-[clamp(22px,3vw,32px)] ${className}`}
    >
      <h3 className="mb-3 flex items-center justify-between gap-2.5 text-lg font-[620]">
        {title}
        {badge ? <span className="pill s text-xs">{badge}</span> : null}
      </h3>
      <dl>
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-t border-(--line) py-2.75 text-[15px]"
          >
            <dt>{label}</dt>
            <dd className="text-right font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
