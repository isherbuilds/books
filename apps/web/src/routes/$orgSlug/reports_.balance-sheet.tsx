import { formatMoney, isZeroMoney } from "@accly/api/core/money";
import { businessDate, formatBusinessDate } from "@accly/api/lib/business-date";
import { Button } from "@accly/ui/components/button";
import { Input } from "@accly/ui/components/input";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { DownloadIcon } from "lucide-react";
import { useDeferredValue } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { ListEmpty, PageBody, PageHeader, ReportBody } from "@/components/page";
import { StatementTree } from "@/components/statement-tree";
import { presetRange } from "@/lib/date-presets";
import { membershipOptions, useCan } from "@/lib/membership";
import { formatDateTime, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { errorMessage } from "@/lib/orpc-error";
import { saveFile } from "@/lib/reports";
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
      void queryClient
        .query(orpc.report.balanceSheet.queryOptions({ input: { orgSlug, asOf: deps.asOf } }))
        .catch(() => {});
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
  const canExport = useCan(orgSlug, { export: ["read"] });
  const asOf = searchedDate ?? today;
  const shownAsOf = shown.asOf ?? today;

  const period = {
    from: presetRange("this-year", shownAsOf, financialYearStart).from,
    to: shownAsOf,
  };

  const download = useMutation({
    mutationFn: () => orpc.export.balanceSheetXlsx.call({ orgSlug, asOf }),
    onSuccess: saveFile,
    onError: (error) => toast.error(errorMessage(error, "Could not build the balance sheet")),
  });

  const pdf = `/api/${encodeURIComponent(orgSlug)}/reports/balance-sheet/pdf?${new URLSearchParams({ asOf })}`;

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
          <div className="flex flex-wrap items-center gap-2">
            {canExport ? (
              <Button
                variant="outline"
                disabled={download.isPending}
                onClick={() => download.mutate()}
              >
                <DownloadIcon data-icon="inline-start" />
                {download.isPending ? "Building…" : "Download XLSX"}
              </Button>
            ) : null}
            <Button
              render={<a href={pdf} target="_blank" rel="noopener noreferrer" />}
              nativeButton={false}
              variant="outline"
            >
              <DownloadIcon data-icon="inline-start" />
              Download PDF
            </Button>
          </div>
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
  const report = useSuspenseQuery(
    orpc.report.balanceSheet.queryOptions({ input: { orgSlug, asOf } }),
  );

  const data = report.data;

  return data.assets.length === 0 &&
    data.liabilities.length === 0 &&
    data.equity.length === 0 &&
    isZeroMoney(data.currentYearProfitPaise) &&
    isZeroMoney(data.earlierYearsProfitPaise) ? (
    <ListEmpty>No account balances as of this date.</ListEmpty>
  ) : (
    <div className="flex flex-col gap-4">
      <div className="text-sm">
        <p className="text-xl font-medium">{data.header.organization.legalName}</p>
        {data.header.organization.gstin ? (
          <p className="text-muted-foreground">GSTIN {data.header.organization.gstin}</p>
        ) : null}
        <p>As of {formatBusinessDate(asOf)}</p>
        <p className="text-muted-foreground">
          Generated {formatDateTime(data.header.generatedAt, data.header.timeZone)} · Period not
          closed
        </p>
      </div>
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
          {formatMoney(data.liabilitiesPaise + data.equityPaise)}
        </span>
      </div>
    </div>
  );
}
