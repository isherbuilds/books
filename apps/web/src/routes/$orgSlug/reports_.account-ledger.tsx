import { formatBalance, formatMoney, isZeroMoney } from "@accly/api/core/money";
import { formatBusinessDay } from "@accly/api/lib/business-date";
import type { AppRouterClient } from "@accly/api/routers/index";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@accly/ui/components/table";
import { useQuery, useSuspenseInfiniteQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, linkOptions, useNavigate } from "@tanstack/react-router";
import { useDeferredValue } from "react";
import { z } from "zod";

import { useDesktop, useVirtualRows } from "@/components/data-table/use-virtual-rows";
import { LinkField } from "@/components/link-field";
import { ErrorNote, ListFooter, PageBody, PageHeader, ReportBody } from "@/components/page";
import { ReportDownloads } from "@/components/report-downloads";
import { ReportPeriod, requireReportPeriod } from "@/components/report-period";
import { ReportProvenance } from "@/components/report-provenance";
import { accountListOptions, deriveAccountRows } from "@/lib/accounts";
import { presetRange } from "@/lib/date-presets";
import { useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { documentLink } from "@/lib/parties";
import {
  accountLedgerLinesOptions,
  accountLedgerSummaryOptions,
  netDebitPaise,
  type AccountLedgerInput,
  withRunningBalance,
} from "@/lib/reports";
import { requireOrgPermission } from "@/lib/route-permission";

type LedgerLine = Awaited<
  ReturnType<AppRouterClient["report"]["accountLedgerLines"]>
>["rows"][number] & { balancePaise: bigint };

export const Route = createFileRoute("/$orgSlug/reports_/account-ledger")({
  head: () => ({ meta: [{ title: "Account ledger · Accly Books" }] }),
  validateSearch: z.object({
    accountId: z.uuid().optional().catch(undefined),
    from: z.iso.date().optional().catch(undefined),
    to: z.iso.date().optional().catch(undefined),
  }),
  beforeLoad: ({ context: { queryClient }, location, params: { orgSlug }, search }) =>
    requireReportPeriod(queryClient, orgSlug, location, search, "this-year"),
  loaderDeps: ({ search }) => search,
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { report: ["readFinancial"] });
    void queryClient.query(accountListOptions(orgSlug)).catch(() => {});

    if (deps.accountId && deps.from && deps.to && deps.from <= deps.to) {
      const input = { orgSlug, accountId: deps.accountId, from: deps.from, to: deps.to };
      void queryClient.infiniteQuery(accountLedgerLinesOptions(input)).catch(() => {});
      void queryClient.query(accountLedgerSummaryOptions(input)).catch(() => {});
    }
  },
  component: AccountLedgerRoute,
});

function AccountLedgerRoute() {
  const { orgSlug } = Route.useParams();
  const search = Route.useSearch();
  const shown = useDeferredValue(search);
  const { accountId, from, to } = search;
  const navigate = useNavigate({ from: Route.fullPath });
  const { today, financialYearStart } = useOrgDateTime();
  const period = from && to ? { from, to } : presetRange("this-year", today, financialYearStart);
  const shownPeriod = { from: shown.from ?? period.from, to: shown.to ?? period.to };
  const shownAccountId = shown.accountId ?? accountId;
  const valid = period.from <= period.to;

  const setSearch = (patch: { accountId?: string; from?: string; to?: string }) =>
    void navigate({ replace: true, search: (previous) => ({ ...previous, ...patch }) });

  return (
    <>
      <PageHeader title="Account ledger" description="Entries and running balance for an account" />
      <PageBody>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-full min-w-56 sm:w-72">
              <AccountPicker
                orgSlug={orgSlug}
                accountId={accountId}
                onSelect={(id) => setSearch({ accountId: id })}
              />
            </div>
            <ReportPeriod period={period} onChange={setSearch} />
          </div>
          <ReportDownloads
            orgSlug={orgSlug}
            ready={valid && accountId !== undefined}
            build={() => {
              // `ready` keeps the button disabled until an account is chosen.
              if (accountId === undefined) throw new Error("No account is chosen");

              return orpc.export.accountLedgerXlsx.call({ orgSlug, accountId, ...period });
            }}
            failure="Could not build the account ledger"
            pdf={linkOptions({
              to: "/api/$orgSlug/reports/account-ledger/pdf",
              params: { orgSlug },
              search: { accountId, ...period },
            })}
          />
        </div>
        {!valid ? <ErrorNote title="The end date must not be before the start date." /> : null}
        <div>
          {!accountId ? (
            <p className="min-h-24 rounded-lg border border-border bg-card px-4 py-3 text-muted-foreground">
              Choose an account to view its ledger.
            </p>
          ) : valid && shownAccountId ? (
            <ReportBody
              resetKey={JSON.stringify([orgSlug, shownAccountId, shownPeriod.from, shownPeriod.to])}
              errorTitle="Could not load account ledger"
              stale={shown !== search}
            >
              <AccountLedgerBody input={{ orgSlug, accountId: shownAccountId, ...shownPeriod }} />
            </ReportBody>
          ) : null}
        </div>
      </PageBody>
    </>
  );
}

function AccountPicker({
  orgSlug,
  accountId,
  onSelect,
}: {
  orgSlug: string;
  accountId?: string;
  onSelect: (id?: string) => void;
}) {
  const chart = useQuery({ ...accountListOptions(orgSlug), select: deriveAccountRows });
  const accounts = chart.data?.filter((account) => !account.isGroup) ?? [];
  const selected = accounts.find((account) => account.id === accountId) ?? null;

  return (
    <LinkField
      items={accounts}
      query={chart}
      noun="posting accounts"
      getKey={(account) => account.id}
      getLabel={(account) => account.name}
      getCode={(account) => account.code}
      getDescription={(account) => (account.active ? undefined : "Inactive")}
      value={selected}
      onSelect={(account) => onSelect(account?.id)}
      placeholder="Choose an account"
    />
  );
}

function AccountLedgerBody({ input }: { input: AccountLedgerInput }) {
  const { orgSlug } = input;
  const summary = useSuspenseQuery(accountLedgerSummaryOptions(input));
  const report = useSuspenseInfiniteQuery(accountLedgerLinesOptions(input));
  const account = summary.data.account;

  const lines: LedgerLine[] = withRunningBalance(
    summary.data.openingPaise,
    report.data.pages.flatMap((page) => page.rows),
    netDebitPaise,
  );

  const desktop = useDesktop();

  const tableRows = useVirtualRows<HTMLTableSectionElement>({
    count: lines.length,
    estimateSize: 40,
    getItemKey: (index) => lines[index]?.id ?? String(index),
    enabled: desktop !== false,
    nextPage: desktop === true ? report : undefined,
  });

  const cards = useVirtualRows<HTMLUListElement, HTMLLIElement>({
    count: lines.length,
    estimateSize: 72,
    getItemKey: (index) => lines[index]?.id ?? String(index),
    enabled: desktop !== true,
    nextPage: desktop === false ? report : undefined,
  });

  return (
    <div className="flex flex-col gap-4">
      <ReportProvenance header={summary.data.header} />
      <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-muted-foreground">
        <span>
          Opening{" "}
          <span className="text-foreground tabular-nums">
            {formatBalance(summary.data.openingPaise)}
          </span>
        </span>
        <span>
          Debits{" "}
          <span className="text-foreground tabular-nums">
            {formatMoney(summary.data.debitPaise)}
          </span>
        </span>
        <span>
          Credits{" "}
          <span className="text-foreground tabular-nums">
            {formatMoney(summary.data.creditPaise)}
          </span>
        </span>
        <span>
          Closing{" "}
          <span className="font-medium text-foreground tabular-nums">
            {formatBalance(summary.data.closingPaise)}
          </span>
        </span>
      </p>
      <div className="min-h-24 shrink-0 overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b px-3 py-2 font-medium">
          {account.code} · {account.name}
          {!account.active ? <span className="text-muted-foreground"> · Inactive</span> : null}
        </div>
        {desktop !== false ? (
          <div
            className={
              desktop === undefined ? "hidden overflow-x-auto md:block" : "overflow-x-auto"
            }
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Document</TableHead>
                  <TableHead>Narration</TableHead>
                  <TableHead>Party</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="font-medium">
                  <TableCell />
                  <TableCell>Opening</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell />
                  <TableCell />
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    {formatBalance(summary.data.openingPaise)}
                  </TableCell>
                </TableRow>
              </TableBody>
              <TableBody ref={tableRows.listRef}>
                {tableRows.paddingTop > 0 ? (
                  <TableRow aria-hidden="true" style={{ height: tableRows.paddingTop }}>
                    <TableCell colSpan={7} className="p-0" />
                  </TableRow>
                ) : null}
                {tableRows.virtualRows.map((item) => {
                  const line = lines[item.index];

                  if (!line) return null;

                  const destination = documentLink(orgSlug, line.documentType, line.documentId);

                  return (
                    <TableRow key={item.key} className="h-10">
                      <TableCell className="whitespace-nowrap">
                        {formatBusinessDay(line.entryDate)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {line.number && destination ? (
                          <Link {...destination} className="underline-offset-4 hover:underline">
                            {line.number}
                          </Link>
                        ) : (
                          (line.number ?? "Allocation")
                        )}
                      </TableCell>
                      <TableCell
                        className="max-w-64 truncate whitespace-nowrap"
                        title={line.narration}
                      >
                        {line.narration}
                        {line.contraAccountName ? (
                          <span className="block text-muted-foreground">
                            {line.contraAccountName}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell
                        className="max-w-48 truncate whitespace-nowrap"
                        title={line.partyName ?? undefined}
                      >
                        {line.partyName ?? ""}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums">
                        {formatMoney(line.debitPaise)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums">
                        {formatMoney(line.creditPaise)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums">
                        {formatBalance(line.balancePaise)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {tableRows.paddingBottom > 0 ? (
                  <TableRow aria-hidden="true" style={{ height: tableRows.paddingBottom }}>
                    <TableCell colSpan={7} className="p-0" />
                  </TableRow>
                ) : null}
              </TableBody>
              <TableBody>
                {!report.hasNextPage ? (
                  <TableRow className="border-t-2 border-foreground font-medium">
                    <TableCell />
                    <TableCell>Closing</TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell />
                    <TableCell />
                    <TableCell className="text-right whitespace-nowrap tabular-nums">
                      {formatBalance(summary.data.closingPaise)}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        ) : null}
        {desktop !== true ? (
          <div className={desktop === undefined ? "divide-y md:hidden" : "divide-y"}>
            <div className="flex items-center justify-between gap-3 px-3 py-2 font-medium tabular-nums">
              <span>Opening</span>
              <span className="whitespace-nowrap">{formatBalance(summary.data.openingPaise)}</span>
            </div>
            <ul ref={cards.listRef}>
              {cards.paddingTop > 0 ? (
                <li aria-hidden="true" style={{ height: cards.paddingTop }} />
              ) : null}
              {cards.virtualRows.map((item) => {
                const line = lines[item.index];

                if (!line) return null;

                const destination = documentLink(orgSlug, line.documentType, line.documentId);

                return (
                  <li
                    key={item.key}
                    data-index={item.index}
                    ref={cards.measureElement}
                    className="flex flex-col gap-1 border-b px-3 py-2"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span className="text-muted-foreground">
                        {formatBusinessDay(line.entryDate)}
                      </span>
                      {line.number && destination ? (
                        <Link
                          {...destination}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {line.number}
                        </Link>
                      ) : (
                        <span className="font-medium">{line.number ?? "Allocation"}</span>
                      )}
                    </div>
                    {line.narration ? <p className="break-words">{line.narration}</p> : null}
                    {line.contraAccountName ? (
                      <p className="break-words text-muted-foreground">{line.contraAccountName}</p>
                    ) : null}
                    {line.partyName ? (
                      <p className="break-words text-muted-foreground">{line.partyName}</p>
                    ) : null}
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 tabular-nums">
                      <span className="whitespace-nowrap">
                        {isZeroMoney(line.debitPaise) ? "Cr" : "Dr"}{" "}
                        {formatMoney(
                          isZeroMoney(line.debitPaise) ? line.creditPaise : line.debitPaise,
                        )}
                      </span>
                      <span className="whitespace-nowrap font-medium">
                        Balance {formatBalance(line.balancePaise)}
                      </span>
                    </div>
                  </li>
                );
              })}
              {cards.paddingBottom > 0 ? (
                <li aria-hidden="true" style={{ height: cards.paddingBottom }} />
              ) : null}
            </ul>
            {!report.hasNextPage ? (
              <div className="flex items-center justify-between gap-3 border-t-2 border-foreground px-3 py-2 font-medium tabular-nums">
                <span>Closing</span>
                <span className="whitespace-nowrap">
                  {formatBalance(summary.data.closingPaise)}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
        <ListFooter query={report} shown={lines.length} />
      </div>
    </div>
  );
}
