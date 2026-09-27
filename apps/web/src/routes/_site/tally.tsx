import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";

import { CtaBand } from "@/components/landing/cta-band";
import { FaqList } from "@/components/landing/faq-list";
import { LabelSection } from "@/components/landing/label-section";
import { PageHero } from "@/components/landing/page-hero";
import { Ticks } from "@/components/landing/ticks";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/_site/tally")({
  head: () => pageHead({ path: "/tally" }),
  component: TallyPage,
});

const MUTED = "text-(--ink-muted)";

const COMES_ACROSS = [
  <>
    Ledgers and groups <span className={MUTED}>with your own names and structure</span>
  </>,
  <>
    Parties <span className={MUTED}>with GSTIN, address and state</span>
  </>,
  <>
    Opening balances <span className={MUTED}>as on the date you choose</span>
  </>,
  <>
    This year’s vouchers <span className={MUTED}>sales, purchase, receipt, payment, journal</span>
  </>,
  <>
    Outstanding bills <span className={MUTED}>bill by bill, so ageing is right from day one</span>
  </>,
  <>
    Stock items{" "}
    <span className={MUTED}>
      with HSN and units <span className="fill">[confirm]</span>
    </span>
  </>,
];

const STEPS = [
  {
    title: "Export from Tally",
    body: "We show you, on a call, where Tally keeps the export. It makes one XML file of your masters and vouchers.",
  },
  {
    title: "Send it to us",
    body: "Upload it in Books or share it with the person helping you. It stays within your account.",
  },
  {
    title: "We map and check",
    body: "Ledgers go to the right groups, parties get their GST details, and anything that doesn’t fit is listed for you to decide.",
  },
  {
    title: "You agree the balance",
    body: "Tally’s trial balance and Books’ side by side. When every group matches, you start entering in Books.",
  },
];

const TRIAL_BALANCE: [string, string][] = [
  ["Capital account", "25,00,000.00 Cr"],
  ["Sundry debtors", "18,42,600.00 Dr"],
  ["Sundry creditors", "6,12,300.00 Cr"],
  ["Bank accounts", "9,87,450.00 Dr"],
  ["Cash-in-hand", "42,150.00 Dr"],
  ["Stock-in-hand", "14,60,000.00 Dr"],
  ["Duties & taxes", "1,24,380.00 Cr"],
  ["Profit & loss a/c", "10,95,520.00 Cr"],
];

const FAQ = [
  {
    q: "Can I keep using Tally while we switch?",
    a: "Yes. Pick a cut-off date, usually the start of a month. Keep entering in Tally until then; we bring everything up to that date across and you start in Books the next day.",
  },
  {
    q: "Which versions of Tally work?",
    a: (
      <span className="fill">
        [TallyPrime and Tally.ERP 9: confirm supported versions before launch.]
      </span>
    ),
  },
  {
    q: "What if I use Busy, Vyapar or Excel?",
    a: (
      <>
        Excel works today: we give you a sheet to fill for parties and opening balances.{" "}
        <span className="fill">[Busy and Vyapar imports: confirm.]</span>
      </>
    ),
  },
  {
    q: "How long does it take?",
    a: (
      <>
        Most of the work is ours. You spend about an hour on the export call and an hour checking
        the balance. <span className="fill">[Confirm typical elapsed days.]</span>
      </>
    ),
  },
  { q: "Does switching cost extra?", a: "No. The move is part of early access." },
];

const CELL = "px-3 py-2.75 whitespace-nowrap border-b";

function TallyPage() {
  return (
    <>
      <PageHero
        kicker="Switch from Tally"
        title="Keep your ledgers. Skip the re-typing."
        actions={
          <Link to="/early-access" className="btn">
            Plan my switch <ArrowRightIcon />
          </Link>
        }
      >
        Your ledgers, parties and this year’s vouchers come across from Tally as they are.{" "}
        <b>A person from our team does the move with you</b>, and it isn’t finished until both trial
        balances agree.
      </PageHero>

      <LabelSection label="What comes across">
        <Ticks
          items={COMES_ACROSS}
          className="grid gap-x-8 text-base min-[761px]:grid-cols-2 [&>li]:border-t [&>li]:border-(--line) [&>li]:py-3.25"
        />
        <p className="mt-6 max-w-[44em] text-sm text-(--ink-muted)">
          Earlier years stay in Tally. Keep it on one computer for looking things up; you won’t need
          to enter anything in it again.
        </p>
      </LabelSection>

      <LabelSection label="How it works">
        <ol className="flex flex-col">
          {STEPS.map((step, i) => (
            <li
              key={step.title}
              className="reveal grid grid-cols-[32px_minmax(0,1fr)] gap-x-6 gap-y-1 border-t border-(--line) py-5.5 first:border-t-0 first:pt-0 min-[641px]:grid-cols-[48px_minmax(0,1fr)_minmax(0,1.2fr)]"
            >
              <span className="pt-0.75 text-sm text-(--faint) tabular-nums">{i + 1}</span>
              <h3 className="text-lg font-[550] tracking-[-0.01em]">{step.title}</h3>
              <p className="col-start-2 text-[15.5px] leading-[1.65] text-(--ink-muted) min-[641px]:col-start-3">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </LabelSection>

      <LabelSection label="The check">
        <p className="max-w-[34em] text-[clamp(20px,2vw,24px)] leading-normal font-[450] tracking-[-0.012em]">
          To the paisa, group by group.{" "}
          <span className="text-(--ink-muted)">
            This is what you sign off before the switch is done.
          </span>
        </p>
        <div className="reveal mt-9 overflow-x-auto rounded-[14px] bg-(--surface) px-5 pt-2 pb-5 ring-1 ring-(--line)">
          <table className="w-full text-[15px] tabular-nums [&_td:nth-child(2)]:text-right [&_td:nth-child(3)]:text-right">
            <caption className="px-3 pt-3.5 pb-1 text-left text-sm text-(--ink-muted)">
              Trial balance as on 31/08/2026 · Sharma Traders, Jaipur (example)
            </caption>
            <thead className="text-left text-[13px] text-(--ink-muted) [&_th]:border-b [&_th]:border-(--line) [&_th]:px-3 [&_th]:pt-3 [&_th]:pb-2.5 [&_th]:font-medium">
              <tr>
                <th>Group</th>
                <th className="text-right">In Tally</th>
                <th className="text-right">In Books</th>
                <th>Check</th>
              </tr>
            </thead>
            <tbody>
              {TRIAL_BALANCE.map(([group, amount], i) => {
                const cell = `${CELL} ${i === TRIAL_BALANCE.length - 1 ? "border-(--ink)" : "border-(--line)"}`;

                return (
                  <tr key={group}>
                    <td className={cell}>{group}</td>
                    <td className={cell}>{amount}</td>
                    <td className={cell}>{amount}</td>
                    <td className={`${cell} font-medium text-(--stamp)`}>Matches</td>
                  </tr>
                );
              })}
              <tr className="total [&_td]:px-3 [&_td]:py-2.75">
                <td>Total, debit and credit</td>
                <td>43,32,200.00</td>
                <td>43,32,200.00</td>
                <td className="text-(--stamp)">Balanced</td>
              </tr>
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
