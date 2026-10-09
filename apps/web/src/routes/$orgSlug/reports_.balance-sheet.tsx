import { formatMoney, isZeroMoney } from "@accly/api/core/money";
import { businessDate } from "@accly/api/lib/business-date";
import { Input } from "@accly/ui/components/input";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, linkOptions, redirect, useNavigate } from "@tanstack/react-router";
import { useDeferredValue } from "react";
import { z } from "zod";

import { ListEmpty, PageBody, PageHeader, ReportBody } from "@/components/page";
import { ReportDownloads } from "@/components/report-downloads";
import { ReportProvenance } from "@/components/report-provenance";
import { StatementTree } from "@/components/statement-tree";
import { presetRange } from "@/lib/date-presets";
import { membershipOptions } from "@/lib/membership";
import { useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { balanceSheetOptions } from "@/lib/reports";
import { requireOrgPermission } from "@/lib/route-permission";

export const Route = createFileRoute("/$orgSlug/reports_/balance-sheet")({
  head: () => ({ meta: [{ title: "Balance sheet · Accly Books" }] }),
  validateSearch: z.object({ asOf: z.iso.date().optional().catch(undefined) }),
  beforeLoad: async ({ context: { queryClient }, location, params: { orgSlug }, search }) => {
    if (search.asOf) return;
    const { timeZone } = await queryClient.query(membershipOptions(orgSlug));
    throw redirect({
      to: location.pathname,
      search: { ...location.search, asOf: businessDate(new Date(), timeZone) },
      replace: true,
    });
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { report: ["readFinancial"] });

    if (deps.asOf) {
      void queryClient.query(balanceSheetOptions(orgSlug, deps.asOf)).catch(() => {});
    }
  },
  component: BalanceSheetRoute,
});

function BalanceSheetRoute() {
  const { orgSlug } = Route.useParams();
  const search = Route.useSearch();
  const shown = useDeferredValue(search);
  const { asOf: searchedDate } = search;
  const navigate = useNavigate({ from: Route.fullPath });
  const { today, financialYearStart } = useOrgDateTime();
  const asOf = searchedDate ?? today;
  const shownAsOf = shown.asOf ?? today;

  const period = {
    from: presetRange("this-year", shownAsOf, financialYearStart).from,
    to: shownAsOf,
  };

  return (
    <>
      <PageHeader title="Balance sheet" description="Assets, liabilities and equity as of a date" />
      <PageBody>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Input
            type="date"
            aria-label="As of"
            className="w-auto"
            value={asOf}
            onChange={(event) =>
              event.target.value &&
              void navigate({ replace: true, search: { asOf: event.target.value } })
            }
          />
          <ReportDownloads
            orgSlug={orgSlug}
            build={() => orpc.export.balanceSheetXlsx.call({ orgSlug, asOf })}
            failure="Could not build the balance sheet"
            pdf={linkOptions({
              to: "/api/$orgSlug/reports/balance-sheet/pdf",
              params: { orgSlug },
              search: { asOf },
            })}
          />
        </div>
        <ReportBody
          resetKey={`${orgSlug}:${shownAsOf}`}
          errorTitle="Could not load balance sheet"
          stale={shown !== search}
        >
          <BalanceSheetBody orgSlug={orgSlug} asOf={shownAsOf} period={period} />
        </ReportBody>
      </PageBody>
    </>
  );
}

function BalanceSheetBody({
  orgSlug,
  asOf,
  period,
}: {
  orgSlug: string;
  asOf: string;
  period: { from: string; to: string };
}) {
  const report = useSuspenseQuery(balanceSheetOptions(orgSlug, asOf));

  const data = report.data;

  return (
    <div className="flex flex-col gap-4">
      <ReportProvenance header={data.header} />
      {data.assets.length === 0 &&
      data.liabilities.length === 0 &&
      data.equity.length === 0 &&
      isZeroMoney(data.currentYearProfitPaise) &&
      isZeroMoney(data.earlierYearsProfitPaise) ? (
        <ListEmpty>No account balances as of this date.</ListEmpty>
      ) : (
        <>
          <StatementTree
            title="Assets"
            nodes={data.assets}
            totalPaise={data.assetsPaise}
            orgSlug={orgSlug}
            period={period}
          />
          <StatementTree
            title="Liabilities"
            nodes={data.liabilities}
            totalPaise={data.liabilitiesPaise}
            orgSlug={orgSlug}
            period={period}
          />
          <StatementTree
            title="Equity"
            nodes={data.equity}
            totalPaise={data.equityPaise}
            orgSlug={orgSlug}
            period={period}
            computedRows={[
              {
                label: "Profit and loss, current year",
                amountPaise: data.currentYearProfitPaise,
              },
              {
                label: "Profit and loss, earlier years",
                amountPaise: data.earlierYearsProfitPaise,
              },
            ]}
          />
          <div className="flex items-center justify-between gap-2 border-t-2 border-foreground px-3 py-2 font-medium md:gap-4">
            <span className="min-w-0 break-words">Total liabilities + equity</span>
            <span className="w-money shrink-0 text-right whitespace-nowrap tabular-nums md:w-auto">
              {/* The server refuses a sheet whose two sides differ. */}
              {formatMoney(data.assetsPaise)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
