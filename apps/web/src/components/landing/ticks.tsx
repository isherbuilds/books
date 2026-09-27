import { CheckIcon } from "lucide-react";
import type { ReactNode } from "react";

/* A list of included things, each with a stamp-coloured tick. */
export function Ticks({
  items,
  className = "",
}: {
  items: readonly ReactNode[];
  className?: string;
}) {
  return (
    <ul className={className}>
      {items.map((item, i) => (
        // oxlint-disable-next-line react/no-array-index-key -- static copy, never reordered
        <li key={i} className="grid grid-cols-[20px_minmax(0,1fr)] gap-1.5">
          <CheckIcon aria-hidden className="mt-1 size-3.5 stroke-[2.2] text-(--stamp)" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
