import { formatBalance, formatMoney } from "@accly/api/core/money";
import { Button } from "@accly/ui/components/button";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DownloadIcon } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { DataTable } from "@/components/data-table/data-table";
import { TableEmpty } from "@/components/data-table/table-empty";
import { PeriodMenu } from "@/components/date-range-filter";
import { LEDGER_COLUMNS, LedgerCard } from "@/components/ledger-columns";
import { ListState, ListToolbar } from "@/components/page";
import type { SearchRange } from "@/lib/date-presets";
import { useCan } from "@/lib/membership";
import { orpc } from "@/lib/orpc";
import { errorMessage } from "@/lib/orpc-error";
import { partyDocumentLink, partyLedgerSummaryOptions } from "@/lib/parties";
import { periodSearch, requirePeriod } from "@/lib/require-period";
import { saveFile } from "@/lib/reports";

const ledgerSearch = z.object({
  ...periodSearch,
});

const ledgerLinesOptions = (
  orgSlug: string,
  partyId: string,
  range: { from?: string; to?: string },
) =>
  orpc.party.ledgerLines.infiniteOptions({
    input: (cursor: { entryDate: string; id: string } | undefined) => ({
      orgSlug,
      partyId,
      ...range,
      cursor,
    }),
    initialPageParam: undefined,
    getNextPageParam: (last) => {
      if (!last.hasMore) return undefined;
      const row = last.rows.at(-1)!;

      return { entryDate: row.entryDate, id: row.id };
    },
  });

export const Route = createFileRoute("/$orgSlug/parties_/$partyId/ledger")({
  validateSearch: ledgerSearch,
  beforeLoad: ({ context: { queryClient }, location, params: { orgSlug }, search }) =>
    requirePeriod(queryClient, orgSlug, location, search, "this-year"),
  loaderDeps: ({ search: { all: _all, ...range } }) => range,
  loader: async ({ context: { queryClient }, deps, params: { orgSlug, partyId } }) => {
    await Promise.all([
      queryClient.infiniteQuery(ledgerLinesOptions(orgSlug, partyId, deps)).catch(() => {}),
      queryClient.query(partyLedgerSummaryOptions(orgSlug, partyId, deps)).catch(() => {}),
    ]);
  },
  component: PartyLedger,
});

// The party's statement of account: every posted exposure line with a running balance,
// Dr when the party owes the organization and Cr for an advance held.
function PartyLedger() {
  const { orgSlug, partyId } = Route.useParams();
  const { all: _all, ...range } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const canExport = useCan(orgSlug, { export: ["read"] });

  const linesQuery = useInfiniteQuery(ledgerLinesOptions(orgSlug, partyId, range));
  const summary = useQuery(partyLedgerSummaryOptions(orgSlug, partyId, range));

  const lines = useMemo(() => {
    if (!summary.data || !linesQuery.data) return [];
    let balancePaise = summary.data.openingPaise;

    return linesQuery.data.pages.flatMap((page) =>
      page.rows.map((row) => ({
        ...row,
        balancePaise: (balancePaise += row.amountPaise),
      })),
    );
  }, [summary.data, linesQuery.data]);

  const download = useMutation({
    mutationFn: () => orpc.export.partyStatementXlsx.call({ orgSlug, partyId, ...range }),
    onSuccess: saveFile,
    onError: (error) => toast.error(errorMessage(error, "Could not build the party statement")),
  });

  const pdfParams = new URLSearchParams();

  if (range.from) pdfParams.set("from", range.from);

  if (range.to) pdfParams.set("to", range.to);
  const pdf = `/api/${encodeURIComponent(orgSlug)}/parties/${encodeURIComponent(partyId)}/statement/pdf${pdfParams.size ? `?${pdfParams}` : ""}`;

  const setSearch = (next: SearchRange) =>
    void navigate({ replace: true, search: (previous) => ({ ...previous, ...next }) });

  return (
    <>
      <ListToolbar>
        <PeriodMenu range={range} onChange={setSearch} />
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
        {summary.data ? (
          <p className="ml-auto flex flex-wrap items-baseline gap-4 text-muted-foreground">
            {range.from ? (
              <span>
                Opening{" "}
                <span className="text-foreground tabular-nums">
                  {formatBalance(summary.data.openingPaise)}
                </span>
              </span>
            ) : null}
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
        ) : null}
      </ListToolbar>

      <ListState
        query={summary}
        errorTitle="Could not load the ledger summary"
        isEmpty={false}
        empty=""
      >
        <DataTable
          columns={LEDGER_COLUMNS}
          data={lines}
          getRowId={(line) => line.id}
          meta={{ orgSlug }}
          rowLink={(line) =>
            partyDocumentLink(orgSlug, partyId, line.documentType, line.documentId)
          }
          renderCard={(line) => <LedgerCard line={line} />}
          query={linesQuery}
          errorTitle="Could not load the ledger"
          empty={
            <TableEmpty
              title="No ledger entries"
              description={
                range.from || range.to
                  ? "Nothing was posted for this party in the period."
                  : "Advances, invoices and their settlements for this party appear here."
              }
            />
          }
        />
      </ListState>
    </>
  );
}
