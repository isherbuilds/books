import type { ReactNode } from "react";

import { Ticks } from "./ticks";

/* One price plan. A badge marks the recommended plan and gives it the ink
   outline. */
export function PlanCard({
  name,
  badge,
  forWhom,
  price,
  perDay,
  features,
  children,
}: {
  name: string;
  badge?: string;
  forWhom: string;
  price: string;
  perDay?: string;
  features: readonly ReactNode[];
  children: ReactNode;
}) {
  return (
    <div
      className={`reveal relative flex flex-col gap-4 rounded-[20px] bg-(--surface) p-6.5 ${
        badge ? "ring-2 ring-(--ink)" : "ring-1 ring-(--line)"
      }`}
    >
      {badge ? (
        <span className="absolute -top-3 left-6 rounded-full bg-(--ink) px-2.5 py-0.5 text-xs font-semibold text-(--on-ink)">
          {badge}
        </span>
      ) : null}
      <h3 className="text-[19px] font-[620]">{name}</h3>
      <p className="min-h-[2.9em] text-[14.5px] leading-[1.45] text-(--ink-muted)">{forWhom}</p>
      <div className="tabular-nums">
        <b className="text-[40px] font-[650] tracking-[-0.035em]">{price}</b>
        <span className="ml-1 text-sm text-(--ink-muted)">+ GST a year</span>
        {perDay ? (
          <small className="mt-0.5 block text-[13.5px] font-[550] text-(--stamp)">{perDay}</small>
        ) : null}
      </div>
      <Ticks
        items={features}
        className="flex flex-col gap-2.5 border-t border-(--line) pt-3.5 text-[14.5px]"
      />
      <div className="mt-auto [&>.btn]:w-full">{children}</div>
    </div>
  );
}
