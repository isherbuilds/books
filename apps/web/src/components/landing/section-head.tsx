import type { ReactNode } from "react";

/* A homepage section's heading and its one-line explanation. */
export function SectionHead({
  id,
  title,
  children,
  className = "",
}: {
  id: string;
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`reveal flex max-w-[760px] flex-col gap-3.5 ${className}`}>
      <h2
        id={id}
        className="text-[clamp(30px,3.8vw,48px)] leading-[1.06] font-[620] tracking-[-0.036em]"
      >
        {title}
      </h2>
      {children ? (
        <p className="text-[clamp(16.5px,1.3vw,18.5px)] leading-[1.6] text-(--ink-muted)">
          {children}
        </p>
      ) : null}
    </div>
  );
}
