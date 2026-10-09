import { formatMoney, isZeroMoney } from "@accly/api/core/money";
import { formatBusinessDay } from "@accly/api/lib/business-date";
import type { AppRouterClient } from "@accly/api/routers/index";
import type { DocumentType } from "@accly/db/schema/documents";
import { Button } from "@accly/ui/components/button";
import { NativeSelect } from "@accly/ui/components/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@accly/ui/components/table";
import { useMutation, useSuspenseInfiniteQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { DownloadIcon } from "lucide-react";
import { useDeferredValue, useMemo } from "react";
import { toast } from "sonner";
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
import { ReportPeriod, requireReportPeriod } from "@/components/report-period";
import { ReportProvenance } from "@/components/report-provenance";
import { useCan } from "@/lib/membership";
import { useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { errorMessage } from "@/lib/orpc-error";
import { documentLink } from "@/lib/parties";
import { saveFile } from "@/lib/reports";
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

type DayEntry = Awaited<ReturnType<AppRouterClient["report"]["dayBookEntries"]>>["rows"][number];

type DayRow = { id: string; entry: DayEntry; lineIndex?: number };

const dayBookEntriesOptions = (input: {
  orgSlug: string;
  from: string;
  to: string;
  documentType?: (typeof DOCUMENT_TYPES)[number]["value"];
}) =>
  orpc.report.dayBookEntries.infiniteOptions({
    input: (cursor: { entryDate: string; id: string } | undefined) => ({ ...input, cursor }),
    initialPageParam: undefined,
    getNextPageParam: (last) => {
      if (!last.hasMore) return undefined;
      const row = last.rows.at(-1)!;

      return { entryDate: row.entryDate, id: row.entryId };
    },
  });

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
      void queryClient.query(orpc.report.dayBookSummary.queryOptions({ input })).catch(() => {});
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
  const canExport = useCan(orgSlug, { export: ["read"] });
  const input = { orgSlug, ...period, documentType };

  const download = useMutation({
    mutationFn: () => orpc.export.dayBookXlsx.call(input),
    onSuccess: saveFile,
    onError: (error) => toast.error(errorMessage(error, "Could not build the day book")),
  });

  const pdfQuery: Record<string, string> = { ...period };

  if (documentType) pdfQuery.documentType = documentType;
  const pdf = `/api/${encodeURIComponent(orgSlug)}/reports/day-book/pdf?${new URLSearchParams(pdfQuery)}`;

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

function DayBookBody({
  input,
}: {
  input: {
    orgSlug: string;
    from: string;
    to: string;
    documentType?: (typeof DOCUMENT_TYPES)[number]["value"];
  };
}) {
  const { orgSlug } = input;
  const summary = useSuspenseQuery(orpc.report.dayBookSummary.queryOptions({ input }));
  const report = useSuspenseInfiniteQuery(dayBookEntriesOptions(input));
  const entries = useMemo(() => report.data.pages.flatMap((page) => page.rows), [report.data]);

  const rows: DayRow[] = useMemo(
    () =>
      entries.flatMap((entry) => [
        { id: entry.entryId, entry },
        ...entry.lines.map((_, lineIndex) => ({
          id: `${entry.entryId}-${lineIndex}`,
          entry,
          lineIndex,
        })),
      ]),
    [entries],
  );

  const desktop = useDesktop();

  const tableRows = useVirtualRows<HTMLTableSectionElement>({
    count: rows.length,
    estimateSize: 40,
    getItemKey: (index) => rows[index]!.id,
    enabled: desktop !== false,
    nextPage: desktop === true ? report : undefined,
  });

  const cards = useVirtualRows<HTMLUListElement, HTMLLIElement>({
    count: entries.length,
    estimateSize: 100,
    getItemKey: (index) => entries[index]!.entryId,
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
                      const { entry, lineIndex } = rows[item.index]!;

                      if (lineIndex !== undefined) {
                        const line = entry.lines[lineIndex]!;

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
                    const entry = entries[item.index]!;

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
