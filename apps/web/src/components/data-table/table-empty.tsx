// Copyright (c) Midday Labs AB, AGPL-3.0, from midday-ai/midday@51587319f26a0ffaa9dfccab1920373cb65689b7
// Adapted from apps/dashboard/src/components/tables/core/empty-states.tsx.
import type { ReactNode } from "react";

// Rendered inside ListState's empty slot, which centres it and mutes the text.
export function TableEmpty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <div className="grid gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
