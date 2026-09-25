import { Button } from "@accly/ui/components/button";
import { Input } from "@accly/ui/components/input";
import { NativeSelect } from "@accly/ui/components/native-select";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DownloadIcon } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { ListSection, PageBody, PageHeader } from "@/components/page";
import { PRESETS, presetLabel, presetOf, presetRange } from "@/lib/date-presets";
import { useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { errorMessage } from "@/lib/orpc-error";
import { requireOrgPermission } from "@/lib/route-permission";

const REPORTS_PERMISSION = { export: ["read"] } as const;

export const Route = createFileRoute("/$orgSlug/reports")({
  head: () => ({ meta: [{ title: "Reports · Accly Books" }] }),
  validateSearch: z.object({
    from: z.iso.date().optional().catch(undefined),
    to: z.iso.date().optional().catch(undefined),
    day: z.iso.date().optional().catch(undefined),
  }),
  loader: ({ context: { queryClient }, params: { orgSlug } }) =>
    requireOrgPermission(queryClient, orgSlug, REPORTS_PERMISSION),
  component: ReportsRoute,
});

type PeriodReport = "gstOutwardXlsx" | "gstInwardXlsx" | "tdsRegisterXlsx";

const PERIOD_REPORTS: readonly { key: PeriodReport; label: string; detail: string }[] = [
  {
    key: "gstOutwardXlsx",
    label: "GST outward register",
    detail: "B2B, B2CL, B2CS, notes, HSN and exempt sheets",
  },
  {
    key: "gstInwardXlsx",
    label: "GST inward register",
    detail: "Bills and notes against them, with eligible and ineligible tax",
  },
  {
    key: "tdsRegisterXlsx",
    label: "TDS register",
    detail: "Tax deducted on payments, by section",
  },
];

// The server returns the workbook as a File; a detached anchor saves it under the
// name the server chose. The object URL is released after the download has started.
function save(file: File) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ReportsRoute() {
  const { orgSlug } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { today, financialYearStart } = useOrgDateTime();

  // Returns are filed for the month just closed, so that is the default period.
  const fallback = presetRange("last-month", today, financialYearStart);
  const from = search.from ?? fallback.from;
  const to = search.to ?? fallback.to;
  const day = search.day ?? today;
  const preset = presetOf({ from, to }, today, financialYearStart);

  const periodDownload = useMutation({
    mutationFn: (key: PeriodReport) => orpc.export[key].call({ orgSlug, from, to }),
    onSuccess: save,
    onError: (error) => toast.error(errorMessage(error, "Could not build the report")),
  });

  const dayBook = useMutation({
    mutationFn: () => orpc.export.dayBookXlsx.call({ orgSlug, date: day }),
    onSuccess: save,
    onError: (error) => toast.error(errorMessage(error, "Could not build the day book")),
  });

  const setSearch = (next: { from?: string; to?: string; day?: string }) =>
    void navigate({ replace: true, search: (previous) => ({ ...previous, ...next }) });

  const pending = periodDownload.isPending ? periodDownload.variables : undefined;

  return (
    <>
      <PageHeader title="Reports" description="Registers for filing and review, as XLSX" />
      <PageBody>
        <ListSection
          label="Period registers"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect
                aria-label="Period"
                className="h-7 w-auto"
                value={preset ?? "custom"}
                onChange={(event) => {
                  const picked = PRESETS.find((candidate) => candidate === event.target.value);

                  if (picked) setSearch(presetRange(picked, today, financialYearStart));
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
                className="h-7 w-auto"
                value={from}
                max={to}
                onChange={(event) => event.target.value && setSearch({ from: event.target.value })}
              />
              <Input
                type="date"
                aria-label="To"
                className="h-7 w-auto"
                value={to}
                min={from}
                onChange={(event) => event.target.value && setSearch({ to: event.target.value })}
              />
            </div>
          }
        >
          <ul className="divide-y">
            {PERIOD_REPORTS.map(({ key, label, detail }) => (
              <li key={key} className="flex min-h-10 items-center gap-3 px-3 py-2">
                <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:gap-3">
                  <span className="font-medium">{label}</span>
                  <span className="truncate text-muted-foreground">{detail}</span>
                </span>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={periodDownload.isPending}
                  onClick={() => periodDownload.mutate(key)}
                >
                  <DownloadIcon data-icon="inline-start" />
                  {pending === key ? "Building…" : "Download"}
                </Button>
              </li>
            ))}
          </ul>
        </ListSection>

        <ListSection
          label="Day book"
          action={
            <Input
              type="date"
              aria-label="Day"
              className="h-7 w-auto"
              value={day}
              max={today}
              onChange={(event) => event.target.value && setSearch({ day: event.target.value })}
            />
          }
        >
          <div className="flex min-h-10 items-center gap-3 px-3 py-2">
            <span className="min-w-0 flex-1 text-muted-foreground">
              Every ledger line posted on the day, with its document and narration
            </span>
            <Button
              size="xs"
              variant="outline"
              disabled={dayBook.isPending}
              onClick={() => dayBook.mutate()}
            >
              <DownloadIcon data-icon="inline-start" />
              {dayBook.isPending ? "Building…" : "Download"}
            </Button>
          </div>
        </ListSection>
      </PageBody>
    </>
  );
}
