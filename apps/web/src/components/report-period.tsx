import { businessDate } from "@accly/api/lib/business-date";
import { Input } from "@accly/ui/components/input";
import { NativeSelect } from "@accly/ui/components/native-select";
import type { QueryClient } from "@tanstack/react-query";
import { redirect, type ParsedLocation } from "@tanstack/react-router";

import {
  PRESETS,
  presetLabel,
  presetOf,
  presetRange,
  type DateRange,
  type Preset,
} from "@/lib/date-presets";
import { membershipOptions } from "@/lib/membership";
import { useOrgDateTime } from "@/lib/org-datetime";

export async function requireReportPeriod(
  queryClient: QueryClient,
  orgSlug: string,
  location: ParsedLocation,
  search: { from?: string; to?: string },
  preset: Preset,
): Promise<void> {
  if (search.from && search.to) return;

  const { timeZone, financialYearStart } = await queryClient.query(membershipOptions(orgSlug));

  const defaults = presetRange(
    preset,
    search.from ?? search.to ?? businessDate(new Date(), timeZone),
    financialYearStart,
  );

  throw redirect({
    to: location.pathname,
    search: {
      ...location.search,
      from: search.from ?? defaults.from,
      to: search.to ?? defaults.to,
    },
    replace: true,
  });
}

export function ReportPeriod({
  period,
  onChange,
  compact = false,
}: {
  period: DateRange;
  onChange: (patch: Partial<DateRange>) => void;
  compact?: boolean;
}) {
  const { today, financialYearStart } = useOrgDateTime();
  const preset = presetOf(period, today, financialYearStart);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect
        aria-label="Period"
        className={compact ? "h-7 w-auto" : undefined}
        value={preset ?? "custom"}
        onChange={(event) => {
          const picked = PRESETS.find((candidate) => candidate === event.target.value);

          if (picked) onChange(presetRange(picked, today, financialYearStart));
        }}
      >
        {PRESETS.map((candidate) => (
          <option key={candidate} value={candidate}>
            {presetLabel(candidate, today, financialYearStart)}
          </option>
        ))}
        <option value="custom" disabled={preset !== undefined}>
          Custom
        </option>
      </NativeSelect>
      <Input
        type="date"
        aria-label="From"
        className={compact ? "h-7 w-auto" : "w-auto"}
        value={period.from}
        max={period.to}
        onChange={(event) => event.target.value && onChange({ from: event.target.value })}
      />
      <Input
        type="date"
        aria-label="To"
        className={compact ? "h-7 w-auto" : "w-auto"}
        value={period.to}
        min={period.from}
        onChange={(event) => event.target.value && onChange({ to: event.target.value })}
      />
    </div>
  );
}
