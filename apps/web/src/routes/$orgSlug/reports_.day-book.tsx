import { formatMoney, isZeroMoney } from "@accly/api/core/money";
import type { DayBookEntry } from "@accly/api/core/reports";
import { formatBusinessDay } from "@accly/api/lib/business-date";
import type { DocumentType } from "@accly/db/schema/documents";
import { NativeSelect } from "@accly/ui/components/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@accly/ui/components/table";
import { useSuspenseInfiniteQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, linkOptions, useNavigate } from "@tanstack/react-router";
import { useDeferredValue } from "react";
import { z } from "zod";

import { useDesktop, useVirtualRows } from "@/components/data-table/use-virtual-rows";
import {
  ErrorNote,
  ListEmpty,
  ListFooter,
  PageBody,
  PageHeader,
  ReportBody,
} from "@/components/page";
import { ReportDownloads } from "@/components/report-downloads";
import { ReportPeriod, requireReportPeriod } from "@/components/report-period";
import { ReportProvenance } from "@/components/report-provenance";
import { useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { documentLink } from "@/lib/parties";
import { dayBookEntriesOptions, dayBookSummaryOptions, type DayBookInput } from "@/lib/reports";
import { requireOrgPermission } from "@/lib/route-permission";

const DOCUMENT_TYPES = [
  { value: "receipt", label: "Receipts" },
  { value: "payment", label: "Payments" },
  { value: "invoice", label: "Invoices" },
  { value: "bill", label: "Bills" },
  { value: "creditNote", label: "Credit notes" },
  { value: "debitNote", label: "Debit notes" },
  { value: "journal", label: "Journals" },
  { value: "openingBalance", label: "Opening balances" },
  { value: "allocation", label: "Allocations" },
] as const satisfies readonly { value: DocumentType | "allocation"; label: string }[];

const documentTypeSchema = z.enum(DOCUMENT_TYPES.map(({ value }) => value));

type DayRow = { id: string; entry: DayBookEntry; line?: DayBookEntry["lines"][number] };

export const Route = createFileRoute("/$orgSlug/reports_/day-book")({
  head: () => ({ meta: [{ title: "Day book · Accly Books" }] }),
  validateSearch: z.object({
    from: z.iso.date().optional().catch(undefined),
    to: z.iso.date().optional().catch(undefined),
    documentType: documentTypeSchema.optional().catch(undefined),
  }),
  beforeLoad: ({ context: { queryClient }, location, params: { orgSlug }, search }) =>
    requireReportPeriod(queryClient, orgSlug, location, search, "today"),
  loaderDeps: ({ search }) => search,
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { report: ["readFinancial"] });

    if (deps.from && deps.to && deps.from <= deps.to) {
      const input = { orgSlug, from: deps.from, to: deps.to, documentType: deps.documentType };
      void queryClient.infiniteQuery(dayBookEntriesOptions(input)).catch(() => {});
      void queryClient.query(dayBookSummaryOptions(input)).catch(() => {});
    }
  },
  component: DayBookRoute,
});

function DayBookRoute() {
  const { orgSlug } = Route.useParams();
  const search = Route.useSearch();
  const shown = useDeferredValue(search);
  const { from, to, documentType } = search;
  const navigate = useNavigate({ from: Route.fullPath });
  const { today } = useOrgDateTime();
  const period = { from: from ?? today, to: to ?? today };
  const shownPeriod = { from: shown.from ?? today, to: shown.to ?? today };
  const valid = period.from <= period.to;
  const input = { orgSlug, ...period, documentType };

  const setSearch = (patch: { from?: string; to?: string; documentType?: typeof documentType }) =>
    void navigate({ replace: true, search: (previous) => ({ ...previous, ...patch }) });

  return (
    <>
      <PageHeader title="Day book" description="Entries posted during a period" />
      <PageBody>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <ReportPeriod period={period} onChange={setSearch} />
            <NativeSelect
              aria-label="Document type"
              value={documentType ?? ""}
              onChange={(event) =>
                setSearch({ documentType: documentTypeSchema.safeParse(event.target.value).data })
              }
            >
              <option value="">All document types</option>
              {DOCUMENT_TYPES.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <ReportDownloads
            orgSlug={orgSlug}
            ready={valid}
            build={() => orpc.export.dayBookXlsx.call(input)}
            failure="Could not build the day book"
            pdf={linkOptions({
              to: "/api/$orgSlug/reports/day-book/pdf",
              params: { orgSlug },
              search: { ...period, documentType },
            })}
          />
        </div>
        {!valid ? <ErrorNote title="The end date must not be before the start date." /> : null}
        {valid ? (
          <ReportBody
            resetKey={JSON.stringify([
              orgSlug,
              shownPeriod.from,
              shownPeriod.to,
              shown.documentType,
            ])}
            errorTitle="Could not load day book"
            stale={shown !== search}
          >
            <DayBookBody input={{ orgSlug, ...shownPeriod, documentType: shown.documentType }} />
          </ReportBody>
        ) : null}
      </PageBody>
    </>
  );
}

function DayBookBody({ input }: { input: DayBookInput }) {
  const { orgSlug } = input;
  const summary = useSuspenseQuery(dayBookSummaryOptions(input));
  const report = useSuspenseInfiniteQuery(dayBookEntriesOptions(input));
  const entries = report.data.pages.flatMap((page) => page.rows);

  const rows: DayRow[] = entries.flatMap((entry) => [
    { id: entry.entryId, entry },
    ...entry.lines.map((line, lineIndex) => ({
      id: `${entry.entryId}-${lineIndex}`,
      entry,
      line,
    })),
  ]);

  const desktop = useDesktop();

  const tableRows = useVirtualRows<HTMLTableSectionElement>({
    count: rows.length,
    estimateSize: 40,
    getItemKey: (index) => rows[index]?.id ?? String(index),
    enabled: desktop !== false,
    nextPage: desktop === true ? report : undefined,
  });

  const cards = useVirtualRows<HTMLUListElement, HTMLLIElement>({
    count: entries.length,
    estimateSize: 100,
    getItemKey: (index) => entries[index]?.entryId ?? String(index),
    enabled: desktop !== true,
    nextPage: desktop === false ? report : undefined,
  });

  return (
    <div className="flex flex-col gap-4">
      <ReportProvenance header={summary.data.header} />
      <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-muted-foreground">
        <span>
          Entries <span className="text-foreground tabular-nums">{summary.data.entryCount}</span>
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
      </p>
      <div className="min-h-24 shrink-0 overflow-hidden rounded-lg border border-border bg-card">
        {entries.length === 0 ? (
          <ListEmpty>No entries posted in this period.</ListEmpty>
        ) : (
          <>
            {desktop !== false ? (
              <div
                className={
                  desktop === undefined ? "hidden overflow-x-auto md:block" : "overflow-x-auto"
                }
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead>Party</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody ref={tableRows.listRef}>
                    {tableRows.paddingTop > 0 ? (
                      <TableRow aria-hidden="true" style={{ height: tableRows.paddingTop }}>
                        <TableCell colSpan={4} className="p-0" />
                      </TableRow>
                    ) : null}
                    {tableRows.virtualRows.map((item) => {
                      const row = rows[item.index];

                      if (!row) return null;
                      const { entry, line } = row;

                      if (line) {
                        return (
                          <TableRow key={item.key} className="h-10">
                            <TableCell className="max-w-64 truncate whitespace-nowrap">
                              <span className="mr-2 font-mono text-muted-foreground">
                                {line.accountCode}
                              </span>
                              {line.accountName}
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
                          </TableRow>
                        );
                      }

                      const destination = documentLink(
                        orgSlug,
                        entry.documentType,
                        entry.documentId,
                      );

                      return (
                        <TableRow key={item.key} className="h-10 bg-muted/40">
                          <TableCell
                            colSpan={4}
                            className="max-w-0 truncate whitespace-nowrap"
                            title={entry.narration}
                          >
                            <span className="mr-3 whitespace-nowrap">
                              {formatBusinessDay(entry.entryDate)}
                            </span>
                            {entry.number && destination ? (
                              <Link
                                {...destination}
                                className="mr-3 font-medium underline-offset-4 hover:underline"
                              >
                                {entry.number}
                              </Link>
                            ) : (
                              <span className="mr-3 font-medium">
                                {entry.number ?? "Allocation"}
                              </span>
                            )}
                            <span className="text-muted-foreground">{entry.narration}</span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {tableRows.paddingBottom > 0 ? (
                      <TableRow aria-hidden="true" style={{ height: tableRows.paddingBottom }}>
                        <TableCell colSpan={4} className="p-0" />
                      </TableRow>
                    ) : null}
                  </TableBody>
                  <TableBody>
                    {!report.hasNextPage ? (
                      <TableRow className="border-t-2 border-foreground font-medium">
                        <TableCell>Total</TableCell>
                        <TableCell />
                        <TableCell className="text-right whitespace-nowrap tabular-nums">
                          {formatMoney(summary.data.debitPaise)}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap tabular-nums">
                          {formatMoney(summary.data.creditPaise)}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
            ) : null}
            {desktop !== true ? (
              <div className={desktop === undefined ? "divide-y md:hidden" : "divide-y"}>
                <ul ref={cards.listRef}>
                  {cards.paddingTop > 0 ? (
                    <li aria-hidden="true" style={{ height: cards.paddingTop }} />
                  ) : null}
                  {cards.virtualRows.map((item) => {
                    const entry = entries[item.index];

                    if (!entry) return null;

                    const destination = documentLink(orgSlug, entry.documentType, entry.documentId);

                    return (
                      <li
                        key={item.key}
                        data-index={item.index}
                        ref={cards.measureElement}
                        className="flex flex-col gap-1 border-b px-3 py-2"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <span className="text-muted-foreground">
                            {formatBusinessDay(entry.entryDate)}
                          </span>
                          {entry.number && destination ? (
                            <Link
                              {...destination}
                              className="font-medium underline-offset-4 hover:underline"
                            >
                              {entry.number}
                            </Link>
                          ) : (
                            <span className="font-medium">{entry.number ?? "Allocation"}</span>
                          )}
                        </div>
                        {entry.narration ? <p className="break-words">{entry.narration}</p> : null}
                        <div className="divide-y">
                          {entry.lines.map((line, index) => (
                            <div
                              key={`${entry.entryId}-${index}`}
                              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2"
                            >
                              <div className="min-w-0 break-words">
                                <span className="mr-2 font-mono text-muted-foreground">
                                  {line.accountCode}
                                </span>
                                {line.accountName}
                                {line.partyName ? (
                                  <span className="block text-muted-foreground">
                                    {line.partyName}
                                  </span>
                                ) : null}
                              </div>
                              <span className="whitespace-nowrap tabular-nums">
                                {isZeroMoney(line.debitPaise) ? "Cr" : "Dr"}{" "}
                                {formatMoney(
                                  isZeroMoney(line.debitPaise) ? line.creditPaise : line.debitPaise,
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      </li>
                    );
                  })}
                  {cards.paddingBottom > 0 ? (
                    <li aria-hidden="true" style={{ height: cards.paddingBottom }} />
                  ) : null}
                </ul>
                {!report.hasNextPage ? (
                  <div className="flex flex-wrap items-baseline justify-between gap-3 border-t-2 border-foreground px-3 py-2 font-medium tabular-nums">
                    <span>Total</span>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      <span className="whitespace-nowrap">
                        Dr {formatMoney(summary.data.debitPaise)}
                      </span>
                      <span className="whitespace-nowrap">
                        Cr {formatMoney(summary.data.creditPaise)}
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            <ListFooter query={report} shown={entries.length} />
          </>
        )}
      </div>
    </div>
  );
}
