import { formatMoney } from "@accly/api/core/money";
import { Button } from "@accly/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@accly/ui/components/table";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { DownloadIcon } from "lucide-react";
import { useDeferredValue } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { ErrorNote, ListEmpty, PageBody, PageHeader, ReportBody } from "@/components/page";
import { ReportPeriod, requireReportPeriod } from "@/components/report-period";
import { ReportProvenance } from "@/components/report-provenance";
import { presetRange } from "@/lib/date-presets";
import { useCan } from "@/lib/membership";
import { useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { errorMessage } from "@/lib/orpc-error";
import { formatSideBalance, saveFile } from "@/lib/reports";
import { requireOrgPermission } from "@/lib/route-permission";

export const Route = createFileRoute("/$orgSlug/reports_/trial-balance")({
  head: () => ({ meta: [{ title: "Trial balance · Accly Books" }] }),
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
          orpc.report.trialBalance.queryOptions({
            input: { orgSlug, from: deps.from, to: deps.to },
          }),
        )
        .catch(() => {});
    }
  },
  component: TrialBalanceRoute,
});

function TrialBalanceRoute() {
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
    mutationFn: () => orpc.export.trialBalanceXlsx.call({ orgSlug, ...period }),
    onSuccess: saveFile,
    onError: (error) => toast.error(errorMessage(error, "Could not build the trial balance")),
  });

  const pdf = `/api/${encodeURIComponent(orgSlug)}/reports/trial-balance/pdf?${new URLSearchParams(period)}`;

  const setPeriod = (patch: Partial<typeof period>) =>
    void navigate({ replace: true, search: (previous) => ({ ...previous, ...patch }) });

  return (
    <>
      <PageHeader title="Trial balance" description="Account balances for a period" />
      <PageBody>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ReportPeriod period={period} onChange={setPeriod} />
          <div className="flex items-center gap-2">
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
        <div className="min-h-24 shrink-0">
          {valid ? (
            <ReportBody
              resetKey={JSON.stringify([orgSlug, shownPeriod.from, shownPeriod.to])}
              errorTitle="Could not load trial balance"
              stale={shown !== search}
            >
              <TrialBalanceBody orgSlug={orgSlug} period={shownPeriod} />
            </ReportBody>
          ) : null}
        </div>
      </PageBody>
    </>
  );
}

function TrialBalanceBody({
  orgSlug,
  period,
}: {
  orgSlug: string;
  period: { from: string; to: string };
}) {
  const report = useSuspenseQuery(
    orpc.report.trialBalance.queryOptions({ input: { orgSlug, ...period } }),
  );

  const rows = report.data.rows;
  const totals = report.data.totals;

  return (
    <div className="flex flex-col gap-4">
      <ReportProvenance header={report.data.header} />
      {rows.length === 0 ? (
        <ListEmpty>No account activity in this period.</ListEmpty>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Opening</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-right">Closing</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.accountId}>
                    <TableCell className="font-mono">{row.code}</TableCell>
                    <TableCell className="min-w-48">
                      <Link
                        to="/$orgSlug/reports/account-ledger"
                        params={{ orgSlug }}
                        search={{ accountId: row.accountId, ...period }}
                        className="underline-offset-4 hover:underline"
                      >
                        {row.name}
                      </Link>
                      {!row.active ? (
                        <span className="text-muted-foreground"> · Inactive</span>
                      ) : null}
                      {row.parentName ? (
                        <span className="block text-xs text-muted-foreground">
                          {row.parentName}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="w-balance text-right whitespace-nowrap">
                      {formatSideBalance(row.openingDebitPaise, row.openingCreditPaise)}
                    </TableCell>
                    <TableCell className="w-money text-right whitespace-nowrap">
                      {formatMoney(row.debitPaise)}
                    </TableCell>
                    <TableCell className="w-money text-right whitespace-nowrap">
                      {formatMoney(row.creditPaise)}
                    </TableCell>
                    <TableCell className="w-balance text-right whitespace-nowrap">
                      {formatSideBalance(row.closingDebitPaise, row.closingCreditPaise)}
                    </TableCell>
                  </TableRow>
                ))}
                {totals ? (
                  <TableRow className="border-t-2 border-foreground font-medium">
                    <TableCell />
                    <TableCell>Total</TableCell>
                    <TableCell className="w-balance text-right whitespace-nowrap tabular-nums">
                      <span className="block">{formatMoney(totals.openingDebitPaise)} Dr</span>
                      <span className="block">{formatMoney(totals.openingCreditPaise)} Cr</span>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {formatMoney(totals.debitPaise)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {formatMoney(totals.creditPaise)}
                    </TableCell>
                    <TableCell className="w-balance text-right whitespace-nowrap tabular-nums">
                      <span className="block">{formatMoney(totals.closingDebitPaise)} Dr</span>
                      <span className="block">{formatMoney(totals.closingCreditPaise)} Cr</span>
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
          <div className="divide-y overflow-hidden rounded-lg border border-border bg-card md:hidden">
            {rows.map((row) => (
              <div key={row.accountId} className="flex flex-col gap-1 px-3 py-2">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-muted-foreground">{row.code}</span>
                  <Link
                    to="/$orgSlug/reports/account-ledger"
                    params={{ orgSlug }}
                    search={{ accountId: row.accountId, ...period }}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {row.name}
                  </Link>
                  {!row.active ? <span className="text-muted-foreground">Inactive</span> : null}
                </div>
                {row.parentName ? (
                  <span className="text-muted-foreground">{row.parentName}</span>
                ) : null}
                <div className="flex justify-between gap-3 tabular-nums">
                  <span className="text-muted-foreground">
                    Opening {formatSideBalance(row.openingDebitPaise, row.openingCreditPaise)}
                  </span>
                  <span>
                    Closing {formatSideBalance(row.closingDebitPaise, row.closingCreditPaise)}
                  </span>
                </div>
              </div>
            ))}
            {totals ? (
              <div className="flex flex-col gap-1 border-t-2 border-foreground px-3 py-2 font-medium tabular-nums">
                <span>Total</span>
                <div className="flex flex-wrap justify-between gap-3">
                  <div className="text-right whitespace-nowrap">
                    <span className="block">Opening</span>
                    <span className="block">{formatMoney(totals.openingDebitPaise)} Dr</span>
                    <span className="block">{formatMoney(totals.openingCreditPaise)} Cr</span>
                  </div>
                  <div className="text-right whitespace-nowrap">
                    <span className="block">Closing</span>
                    <span className="block">{formatMoney(totals.closingDebitPaise)} Dr</span>
                    <span className="block">{formatMoney(totals.closingCreditPaise)} Cr</span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
