import { formatMoney, isPositiveMoney, isZeroMoney } from "@accly/api/core/money";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, linkOptions, useNavigate } from "@tanstack/react-router";
import { useDeferredValue } from "react";
import { z } from "zod";

import { ErrorNote, ListEmpty, PageBody, PageHeader, ReportBody } from "@/components/page";
import { ReportDownloads } from "@/components/report-downloads";
import { ReportPeriod, requireReportPeriod } from "@/components/report-period";
import { ReportProvenance } from "@/components/report-provenance";
import { StatementTree } from "@/components/statement-tree";
import { presetRange } from "@/lib/date-presets";
import { useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { profitAndLossOptions } from "@/lib/reports";
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
        .query(profitAndLossOptions(orgSlug, { from: deps.from, to: deps.to }))
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
  const period = from && to ? { from, to } : presetRange("this-year", today, financialYearStart);
  const shownPeriod = { from: shown.from ?? period.from, to: shown.to ?? period.to };
  const valid = period.from <= period.to;

  const setPeriod = (patch: Partial<typeof period>) =>
    void navigate({ replace: true, search: (previous) => ({ ...previous, ...patch }) });

  return (
    <>
      <PageHeader title="Profit and loss" description="Income and expenses for a period" />
      <PageBody>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ReportPeriod period={period} onChange={setPeriod} />
          <ReportDownloads
            orgSlug={orgSlug}
            ready={valid}
            build={() => orpc.export.profitAndLossXlsx.call({ orgSlug, ...period })}
            failure="Could not build the profit and loss report"
            pdf={linkOptions({
              to: "/api/$orgSlug/reports/profit-and-loss/pdf",
              params: { orgSlug },
              search: period,
            })}
          />
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
  const report = useSuspenseQuery(profitAndLossOptions(orgSlug, period));

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
