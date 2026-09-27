import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";

const inr = new Intl.NumberFormat("en-IN");

/* ₹8.2 lakh, ₹1.25 crore, ₹98,630: how an Indian owner says the amount. */
function rupees(amount: number) {
  if (amount >= 1e7) return `₹${(amount / 1e7).toFixed(2).replace(/\.?0+$/, "")} crore`;

  if (amount >= 1e5) return `₹${(amount / 1e5).toFixed(1).replace(/\.0$/, "")} lakh`;

  return `₹${inr.format(Math.round(amount))}`;
}

/* Money tied up in receivables, and what collecting sooner frees. Credit sales
   in lakh a month; interest at 12% a year on the cash freed. */
function receivables(salesLakh: number, days: number, sooner: number) {
  const perDay = (salesLakh * 1e5 * 12) / 365;
  const freed = perDay * Math.min(sooner, days);

  return { withCustomers: perDay * days, freed, interest: freed * 0.12 };
}

export function Calculator() {
  const [sales, setSales] = useState(25);
  const [days, setDays] = useState(60);
  const [sooner, setSooner] = useState(10);
  const figures = receivables(sales, days, sooner);

  return (
    <div className="grid gap-4 min-[861px]:grid-cols-2">
      <div className="reveal flex flex-col gap-6.5 rounded-[20px] bg-(--surface) p-[clamp(22px,3vw,34px)] ring-1 ring-(--line)">
        <Slider
          label="Credit sales a month"
          min={2}
          max={300}
          value={sales}
          onChange={setSales}
          shown={rupees(sales * 1e5)}
          ends={["₹2 lakh", "₹3 crore"]}
        />
        <Slider
          label="Days customers take to pay"
          min={10}
          max={150}
          step={5}
          value={days}
          onChange={setDays}
          shown={`${days} days`}
          ends={["10", "150"]}
        />
        <Slider
          label="If you got paid this many days sooner"
          min={0}
          max={45}
          value={sooner}
          onChange={setSooner}
          shown={`${Math.min(sooner, days)} days`}
          ends={["0", "45"]}
        />
      </div>
      <div className="band reveal flex flex-col gap-4.5 rounded-[20px] bg-(--band) p-[clamp(22px,3vw,34px)] text-(--band-ink) ring-1 ring-(--band-line)">
        <Figure label="With customers right now" value={rupees(figures.withCustomers)} />
        <div className="flex items-baseline justify-between gap-4 border-b-4 border-double border-(--band-stamp) pb-2">
          <span className="text-[15px] text-(--band-muted)">Cash back in your bank</span>
          <b
            aria-live="polite"
            aria-atomic="true"
            className="text-[clamp(32px,3.6vw,46px)] font-[650] tracking-[-0.025em] whitespace-nowrap text-(--band-stamp) tabular-nums"
          >
            {rupees(figures.freed)}
          </b>
        </div>
        <Figure
          label="Interest saved a year, at 12%"
          value={`₹${inr.format(Math.round(figures.interest))}`}
        />
        <p className="text-sm leading-[1.55] text-(--band-muted)">
          Books costs <b className="text-(--band-ink)">₹9,999 a year</b>. Reminders, UPI links and a
          daily call list are how the days come down; how many is up to your customers.
        </p>
        <Link to="/" hash="callback" className="btn mt-auto self-start">
          Start with my overdue list
        </Link>
      </div>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-(--band-line) pb-4">
      <span className="text-[15px] text-(--band-muted)">{label}</span>
      <b className="text-[clamp(24px,2.6vw,32px)] font-[650] tracking-[-0.025em] whitespace-nowrap tabular-nums">
        {value}
      </b>
    </div>
  );
}

function Slider({
  label,
  shown,
  ends,
  onChange,
  ...range
}: {
  label: string;
  shown: string;
  ends: [string, string];
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const id = useId();

  return (
    <div>
      <label
        htmlFor={id}
        className="flex items-baseline justify-between gap-3 text-[15px] font-medium"
      >
        {label}
        <output
          htmlFor={id}
          className="text-xl font-[650] tracking-[-0.02em] whitespace-nowrap tabular-nums"
        >
          {shown}
        </output>
      </label>
      <input
        id={id}
        type="range"
        {...range}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
        className="mt-3 h-6 w-full accent-(--stamp)"
      />
      <small className="flex justify-between text-xs text-(--faint) tabular-nums">
        <span>{ends[0]}</span>
        <span>{ends[1]}</span>
      </small>
    </div>
  );
}
