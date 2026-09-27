import { useId, type ReactNode } from "react";

/* A sub-page section: a quiet label in the left quarter, the content in the
   rest; stacked on narrow screens. */
export function LabelSection({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();

  return (
    <section aria-labelledby={id} className="border-t border-(--line) py-[clamp(56px,7vw,96px)]">
      <div className="wrap grid grid-cols-12 gap-x-6">
        <h2
          id={id}
          className="col-span-12 mb-6 text-sm font-medium text-(--ink-muted) min-[861px]:col-span-3 min-[861px]:mb-0 min-[861px]:pt-1.5"
        >
          {label}
        </h2>
        <div className="col-span-12 min-w-0 min-[861px]:col-span-9">{children}</div>
      </div>
    </section>
  );
}
