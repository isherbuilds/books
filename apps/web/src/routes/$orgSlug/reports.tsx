import { authorize } from "@accly/auth/access";
import { Button } from "@accly/ui/components/button";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { DownloadIcon } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { ListSection, PageBody, PageHeader } from "@/components/page";
import { ReportPeriod } from "@/components/report-period";
import { presetRange } from "@/lib/date-presets";
import { membershipOptions, useCan } from "@/lib/membership";
import { useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { errorMessage } from "@/lib/orpc-error";
import { saveFile } from "@/lib/reports";

const EXPORT_PERMISSION = { export: ["read"] } as const;

const FINANCIAL_PERMISSION = { report: ["readFinancial"] } as const;

export const Route = createFileRoute("/$orgSlug/reports")({
  head: () => ({ meta: [{ title: "Reports · Accly Books" }] }),
  validateSearch: z.object({
    from: z.iso.date().optional().catch(undefined),
    to: z.iso.date().optional().catch(undefined),
  }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    const membership = await queryClient.query(membershipOptions(orgSlug));

    if (
      !authorize(membership.roles, EXPORT_PERMISSION) &&
      !authorize(membership.roles, FINANCIAL_PERMISSION)
    ) {
      throw redirect({ to: "/$orgSlug", params: { orgSlug }, search: { access: "denied" } });
    }
  },
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

const FINANCIAL_REPORTS = [
  {
    to: "/$orgSlug/reports/trial-balance",
    label: "Trial balance",
    detail: "Opening, activity and closing balance by account",
  },
  {
    to: "/$orgSlug/reports/profit-and-loss",
    label: "Profit and loss",
    detail: "Income, expenses and net profit",
  },
  {
    to: "/$orgSlug/reports/balance-sheet",
    label: "Balance sheet",
    detail: "Assets, liabilities and equity as of a date",
  },
  {
    to: "/$orgSlug/reports/account-ledger",
    label: "Account ledger",
    detail: "Entries and running balance for an account",
  },
  { to: "/$orgSlug/reports/day-book", label: "Day book", detail: "Entries posted during a period" },
  {
    to: "/$orgSlug/parties",
    label: "Party statements",
    detail: "Choose a party, then open Ledger to download its statement",
  },
] as const;

function ReportsRoute() {
  const { orgSlug } = Route.useParams();
  const canExport = useCan(orgSlug, EXPORT_PERMISSION);
  const canReadFinancial = useCan(orgSlug, FINANCIAL_PERMISSION);
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { today, financialYearStart } = useOrgDateTime();

  // Returns are filed for the month just closed, so that is the default period.
  const fallback = presetRange("last-month", today, financialYearStart);
  const from = search.from ?? fallback.from;
  const to = search.to ?? fallback.to;

  const periodDownload = useMutation({
    mutationFn: (key: PeriodReport) => orpc.export[key].call({ orgSlug, from, to }),
    onSuccess: saveFile,
    // oxlint-disable-next-line accly/write-errors-via-handler -- a report download reads; it writes nothing
    onError: (error) => toast.error(errorMessage(error, "Could not build the report")),
  });

  const setSearch = (next: { from?: string; to?: string }) =>
    void navigate({ replace: true, search: (previous) => ({ ...previous, ...next }) });

  const pending = periodDownload.isPending ? periodDownload.variables : undefined;

  return (
    <>
      <PageHeader title="Reports" description="Financial statements and filing registers" />
      <PageBody>
        {canReadFinancial ? (
          <ListSection label="Financial reports">
            {FINANCIAL_REPORTS.map(({ to, label, detail }) => (
              <Link
                key={to}
                to={to}
                params={{ orgSlug }}
                className="flex min-h-10 flex-wrap items-baseline gap-x-3 px-3 py-2 hover:bg-accent/70"
              >
                <span className="font-medium">{label}</span>
                <span className="text-muted-foreground">{detail}</span>
              </Link>
            ))}
          </ListSection>
        ) : null}
        {canExport ? (
          <>
            <ListSection
              label="Period registers"
              action={<ReportPeriod period={{ from, to }} onChange={setSearch} compact />}
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
          </>
        ) : null}
      </PageBody>
    </>
  );
}
