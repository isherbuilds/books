import { formatMoney, isPositiveMoney, isZeroMoney } from "@accly/api/core/money";
import { Button } from "@accly/ui/components/button";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DownloadIcon } from "lucide-react";
import { useDeferredValue } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { ErrorNote, ListEmpty, PageBody, PageHeader, ReportBody } from "@/components/page";
import { ReportPeriod, requireReportPeriod } from "@/components/report-period";
import { ReportProvenance } from "@/components/report-provenance";
import { StatementTree } from "@/components/statement-tree";
import { presetRange } from "@/lib/date-presets";
import { useCan } from "@/lib/membership";
import { useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { errorMessage } from "@/lib/orpc-error";
import { saveFile } from "@/lib/reports";
import { requireOrgPermission } from "@/lib/route-permission";

export const Route = createFileRoute("/$orgSlug/reports_/profit-and-loss")({
  head: () => ({ meta: [{ title: "Profit and loss · Accly Books" }] }),
  validateSearch: z.object({
    from: z.iso.date().optional().catch(undefined),
    to: z.iso.date().optional().catch(undefined),
  }),
  beforeLoad: ({ context: { queryClient }, location, params: { orgSlug }, search }) =>
    requireReportPeriod(queryClient, orgSlug, location, search, "this-year"),
  loaderDeps: ({ search }) => search,
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { report: ["readFinancial"] });

    if (deps.from && deps.to && deps.from <= deps.to) {
      void queryClient
        .query(
          orpc.report.profitAndLoss.queryOptions({
            input: { orgSlug, from: deps.from, to: deps.to },
          }),
        )
        .catch(() => {});
    }
  },
  component: ProfitAndLossRoute,
});

function ProfitAndLossRoute() {
  const { orgSlug } = Route.useParams();
  const search = Route.useSearch();
  const shown = useDeferredValue(search);
  const { from, to } = search;
  const navigate = useNavigate({ from: Route.fullPath });
  const { today, financialYearStart } = useOrgDateTime();
  const canExport = useCan(orgSlug, { export: ["read"] });
  const period = from && to ? { from, to } : presetRange("this-year", today, financialYearStart);
  const shownPeriod = { from: shown.from ?? period.from, to: shown.to ?? period.to };
  const valid = period.from <= period.to;

  const download = useMutation({
    mutationFn: () => orpc.export.profitAndLossXlsx.call({ orgSlug, ...period }),
    onSuccess: saveFile,
    onError: (error) =>
      toast.error(errorMessage(error, "Could not build the profit and loss report")),
  });

  const pdf = `/api/${encodeURIComponent(orgSlug)}/reports/profit-and-loss/pdf?${new URLSearchParams(period)}`;

  const setPeriod = (patch: Partial<typeof period>) =>
    void navigate({ replace: true, search: (previous) => ({ ...previous, ...patch }) });

  return (
    <>
      <PageHeader title="Profit and loss" description="Income and expenses for a period" />
      <PageBody>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ReportPeriod period={period} onChange={setPeriod} />
          <div className="flex flex-wrap items-center gap-2">
            {canExport ? (
              <Button
                variant="outline"
                disabled={!valid || download.isPending}
                onClick={() => download.mutate()}
              >
                <DownloadIcon data-icon="inline-start" />
                {download.isPending ? "Building…" : "Download XLSX"}
              </Button>
            ) : null}
            {valid ? (
              <Button
                render={<a href={pdf} target="_blank" rel="noopener noreferrer" />}
                nativeButton={false}
                variant="outline"
              >
                <DownloadIcon data-icon="inline-start" />
                Download PDF
              </Button>
            ) : null}
          </div>
        </div>
        {!valid ? <ErrorNote title="The end date must not be before the start date." /> : null}
        {valid ? (
          <ReportBody
            resetKey={JSON.stringify([orgSlug, shownPeriod.from, shownPeriod.to])}
            errorTitle="Could not load profit and loss"
            stale={shown !== search}
          >
            <ProfitAndLossBody orgSlug={orgSlug} period={shownPeriod} />
          </ReportBody>
        ) : null}
      </PageBody>
    </>
  );
}

function ProfitAndLossBody({
  orgSlug,
  period,
}: {
  orgSlug: string;
  period: { from: string; to: string };
}) {
  const report = useSuspenseQuery(
    orpc.report.profitAndLoss.queryOptions({ input: { orgSlug, ...period } }),
  );

  const data = report.data;

  return (
    <div className="flex flex-col gap-4">
      <ReportProvenance header={data.header} />
      {data.income.length === 0 && data.expenses.length === 0 ? (
        <ListEmpty>No income or expense activity in this period.</ListEmpty>
      ) : (
        <>
          <StatementTree
            title="Income"
            nodes={data.income}
            totalPaise={data.incomePaise}
            orgSlug={orgSlug}
            period={period}
          />
          <StatementTree
            title="Expenses"
            nodes={data.expenses}
            totalPaise={data.expensesPaise}
            orgSlug={orgSlug}
            period={period}
          />
          <div className="flex items-center justify-between gap-2 border-t-2 border-foreground px-3 py-2 font-medium md:gap-4">
            <span className="min-w-0 break-words">
              {isPositiveMoney(data.netProfitPaise) || isZeroMoney(data.netProfitPaise)
                ? "Net profit"
                : "Net loss"}
            </span>
            <span className="w-money shrink-0 text-right whitespace-nowrap tabular-nums md:w-auto">
              {formatMoney(data.netProfitPaise)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
