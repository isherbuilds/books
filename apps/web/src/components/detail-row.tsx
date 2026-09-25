import { cn } from "@accly/ui/lib/utils";
import type { ReactNode } from "react";

/** One label and value row of a record Sheet's `<dl>`; an empty value omits the row. */
export function DetailRow({
  label,
  children,
  mono,
}: {
  label: string;
  children?: ReactNode;
  mono?: boolean;
}) {
  if (!children) return null;

  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 text-right wrap-anywhere", mono && "font-mono")}>{children}</dd>
    </div>
  );
}
