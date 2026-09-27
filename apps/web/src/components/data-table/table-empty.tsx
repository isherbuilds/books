// Copyright (c) Midday Labs AB, AGPL-3.0, from midday-ai/midday@51587319f26a0ffaa9dfccab1920373cb65689b7
// Adapted from apps/dashboard/src/components/tables/core/empty-states.tsx.
import { Button } from "@accly/ui/components/button";
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
        <p className="text-base font-medium text-foreground">{title}</p>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

/** A register's empty rows: a filtered view offers Clear; an empty one says what appears. */
export function RegisterEmpty({
  noun,
  filtered,
  onClear,
  description,
}: {
  noun: string;
  filtered: boolean;
  onClear: () => void;
  description: string;
}) {
  if (!filtered) return <TableEmpty title={`No ${noun} yet`} description={description} />;

  return (
    <TableEmpty
      title={`No ${noun} match`}
      description="Try another search or clear the filters."
      action={
        <Button size="xs" variant="outline" onClick={onClear}>
          Clear filters
        </Button>
      }
    />
  );
}
