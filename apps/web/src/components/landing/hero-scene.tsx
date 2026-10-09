import { useEffect, useRef, useState } from "react";

import { Person } from "./person";
import { WaIcon } from "./wa-icon";

const LABEL = "text-[10px] font-semibold tracking-[0.08em] text-(--ink-muted) uppercase";

/* An overdue invoice is reminded on WhatsApp and gets paid. The loop itself is
   CSS (`.scene` in marketing.css); this component only runs it while the scene
   is on screen, the tab is visible and the visitor has not paused it. */
export function HeroScene() {
  const scene = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const element = scene.current;

    if (!element) return;
    let onScreen = false;

    const sync = () => {
      element.dataset.play = onScreen && !document.hidden && !paused ? "running" : "paused";
    };

    const observer = new IntersectionObserver(
      (entries) => {
        // The newest record for the one observed element wins.
        for (const entry of entries) onScreen = entry.isIntersecting;
        sync();
      },
      { threshold: 0.25 },
    );

    observer.observe(element);
    document.addEventListener("visibilitychange", sync);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [paused]);

  return (
    <div ref={scene} className="scene">
      <div
        role="img"
        aria-label="Example: an overdue invoice is reminded on WhatsApp and gets paid"
        className="absolute inset-0"
      >
        <div className="phone">
          <div className="screen">
            <div className="flex justify-between px-4.5 pt-2.5 pb-1 text-[11px] font-semibold tabular-nums">
              <span>9:41</span>
              <span>4G</span>
            </div>
            <div className="px-4 pt-2 pb-2.5">
              <small className="block text-[11px] text-(--ink-muted)">
                Sharma Traders · Jaipur
              </small>
              <b className="text-[15px]">Good morning, Rakesh</b>
            </div>
            <div className="mx-3 rounded-2xl bg-(--surface) px-3.5 py-3 ring-1 ring-(--line)">
              <small className={LABEL}>You’re owed</small>
              <div className="swap text-[25px] font-[650] tracking-[-0.03em] tabular-nums">
                <span className="before">₹18,42,600</span>
                <span className="after">₹17,93,950</span>
              </div>
              <div className="swap text-[11px] tabular-nums">
                <span className="before text-(--danger)">₹48,650 overdue</span>
                <span className="after text-(--stamp)">Nothing overdue</span>
              </div>
            </div>
            <div className="mx-3 mt-3 flex flex-col gap-2">
              <span className={`${LABEL} pl-0.5`}>Call today</span>
              <div className="card-row ring-[1.5px] ring-(--ink)">
                <b className="text-[12.5px] font-semibold">Rathore Hardware</b>
                <span className="text-right font-semibold tabular-nums">₹48,650</span>
                <small className="text-[10.5px] text-(--ink-muted)">INV-00318</small>
                <span className="swap justify-self-end justify-items-end">
                  <span className="before pill d">7 days late</span>
                  <span className="after pill s">Paid</span>
                </span>
                <span className="swap col-span-full mt-1.5 text-[11.5px] font-semibold [&>*]:flex [&>*]:h-7.5 [&>*]:items-center [&>*]:justify-center [&>*]:gap-1.5 [&>*]:rounded-[9px] [&_svg]:size-3.25">
                  <span className="before bg-(--ink) text-(--on-ink)">
                    <WaIcon />
                    Send on WhatsApp
                  </span>
                  <span className="after bg-(--stamp-soft) text-(--stamp)">
                    Reminder sent · 10:02 am
                  </span>
                </span>
              </div>
              <div className="card-row">
                <b className="text-[12.5px] font-semibold">Mehta &amp; Sons</b>
                <span className="text-right font-semibold tabular-nums">₹1,42,000</span>
                <small className="text-[10.5px] text-(--ink-muted)">INV-00339</small>
                <span className="pill w justify-self-end">Due in 5 days</span>
              </div>
              <div className="card-row">
                <b className="text-[12.5px] font-semibold">Bansal Traders</b>
                <span className="text-right font-semibold tabular-nums">₹42,600</span>
                <small className="text-[10.5px] text-(--ink-muted)">INV-00347</small>
                <span className="pill w justify-self-end">Part paid</span>
              </div>
            </div>
          </div>
        </div>

        <div className="chat">
          <div className="flex items-center gap-2 border-b border-(--line) pb-1.5 text-xs">
            <i className="flex size-6.5 flex-none items-center justify-center rounded-full bg-(--surface) text-[10.5px] font-bold not-italic">
              RH
            </i>
            <b className="text-[13px] font-semibold">Rathore Hardware</b>
          </div>
          <p className="bubble b1 self-end rounded-br-[4px]">
            Namaste ji, INV-00318 for ₹48,650 was due on 19/09.
            <span className="mt-1.5 block rounded-lg bg-(--sunken) px-2 py-1.5 text-xs font-semibold">
              View bill · Pay by UPI
            </span>
            <Time>10:02 am</Time>
          </p>
          <p className="bubble b2 self-start rounded-bl-[4px]">
            Paid by UPI just now.
            <Time>10:14 am</Time>
          </p>
          <p className="bubble b3 self-end rounded-br-[4px]">
            Received, thank you.
            <Time>10:15 am</Time>
          </p>
        </div>

        <div className="stamp">
          <b className="text-[28px]">Paid</b>
          <small className="text-[10.5px] font-bold tracking-widest">UPI · 10:14 am</small>
        </div>
        <span className="scene-note hand">paid in 12 minutes</span>
        <Person label="Placeholder for a cut-out photo of an owner" className="scene-owner" />
      </div>

      <button
        type="button"
        className="scene-toggle h-8 rounded-full bg-(--surface) px-3 text-[12.5px] text-(--ink-muted) ring-1 ring-(--line)"
        onClick={() => setPaused(!paused)}
      >
        {paused ? "Play" : "Pause"}
      </button>
    </div>
  );
}

function Time({ children }: { children: string }) {
  return (
    <small className="mt-0.5 block text-right text-[10.5px] text-(--ink-muted) tabular-nums">
      {children}
    </small>
  );
}
