import type * as React from "react";

import { cn } from "@accly/ui/lib/utils";

// The shadcn base-lyra `kbd`, rounded-sm: rounded-md on a 20 px box reads as a pill.
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm border border-border bg-muted px-1 font-sans text-xs text-muted-foreground tabular-nums select-none [&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };
