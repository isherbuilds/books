import type * as React from "react";

import { controlBase } from "@accly/ui/lib/control";
import { cn } from "@accly/ui/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        controlBase,
        "flex field-sizing-content min-h-16 w-full resize-none px-2.5 py-2",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
