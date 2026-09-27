import type { ReactNode } from "react";

/* The opening of every page but the homepage: kicker, headline, lede and an
   optional action row, entering in a short stagger. */
export function PageHero({
  kicker,
  title,
  children,
  actions,
}: {
  kicker: string;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="wrap pt-[clamp(64px,9vw,120px)] pb-[clamp(40px,5vw,64px)]">
      <p className="rise mb-6 flex items-center gap-2.5 text-sm font-medium text-(--ink-muted)">
        <span aria-hidden className="size-1.75 rounded-full bg-(--stamp)" />
        {kicker}
      </p>
      <h1 className="max-w-[15ch] text-[clamp(40px,6vw,76px)] leading-[1.02] font-[580] tracking-[-0.042em]">
        {title}
      </h1>
      {children ? (
        <p className="rise [--d:160ms] mt-6 max-w-[36em] text-[clamp(17px,1.5vw,20px)] leading-[1.6] text-(--ink-muted) [&_b]:font-medium [&_b]:text-(--ink)">
          {children}
        </p>
      ) : null}
      {actions ? (
        <div className="rise [--d:240ms] mt-8 flex flex-wrap items-center gap-6">{actions}</div>
      ) : null}
    </section>
  );
}
