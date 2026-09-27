import { cn } from "@accly/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

// The design system's four status meanings, each led by a dot and always carrying a
// word: `settled` (stamp: paid, applied, posted), `warn` (provisional or due: draft,
// unpaid, invited), `danger` (act on it: overdue, denied) and `neutral` (identity and
// in-between: roles, part paid, cancelled, inactive). No fifth colour.
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1.5 rounded-sm px-1.5 py-0.5 text-xs font-medium whitespace-nowrap before:size-1.5 before:shrink-0 before:rounded-full before:bg-current [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3",
  {
    variants: {
      variant: {
        neutral: "bg-muted text-muted-foreground",
        settled: "bg-stamp-soft text-stamp",
        warn: "bg-warn-soft text-warn",
        danger: "bg-danger-soft text-danger",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant, className }))} {...props} />
  );
}

export { Badge };
