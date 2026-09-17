import { cn } from "@accly/ui/lib/utils";
import type { ReactNode } from "react";

/** One label and value row of a record Sheet's `<dl>`; an empty value shows a dash. */
export function DetailRow({
  label,
  children,
  mono,
}: {
  label: string;
  children?: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "min-w-0 text-right break-words",
          children ? mono && "font-mono" : "text-muted-foreground",
        )}
      >
        {children || "—"}
      </dd>
    </div>
  );
}
