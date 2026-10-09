import { formatBalance, formatMoney } from "@accly/api/core/money";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, linkOptions, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { DataTable } from "@/components/data-table/data-table";
import { TableEmpty } from "@/components/data-table/table-empty";
import { PeriodMenu } from "@/components/date-range-filter";
import { LEDGER_COLUMNS, LedgerCard } from "@/components/ledger-columns";
import { ListState, ListToolbar } from "@/components/page";
import { ReportDownloads } from "@/components/report-downloads";
import type { SearchRange } from "@/lib/date-presets";
import { orpc } from "@/lib/orpc";
import {
  partyDocumentLink,
  partyLedgerLinesOptions,
  partyLedgerSummaryOptions,
} from "@/lib/parties";
import { withRunningBalance } from "@/lib/reports";
import { periodSearch, requirePeriod } from "@/lib/require-period";

const ledgerSearch = z.object({
  ...periodSearch,
});

export const Route = createFileRoute("/$orgSlug/parties_/$partyId/ledger")({
  validateSearch: ledgerSearch,
  beforeLoad: ({ context: { queryClient }, location, params: { orgSlug }, search }) =>
    requirePeriod(queryClient, orgSlug, location, search, "this-year"),
  loaderDeps: ({ search: { all: _all, ...range } }) => range,
  loader: async ({ context: { queryClient }, deps, params: { orgSlug, partyId } }) => {
    await Promise.all([
      queryClient.infiniteQuery(partyLedgerLinesOptions(orgSlug, partyId, deps)).catch(() => {}),
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

  const linesQuery = useInfiniteQuery(partyLedgerLinesOptions(orgSlug, partyId, range));
  const summary = useQuery(partyLedgerSummaryOptions(orgSlug, partyId, range));

  const lines =
    summary.data && linesQuery.data
      ? withRunningBalance(
          summary.data.openingPaise,
          linesQuery.data.pages.flatMap((page) => page.rows),
          (row) => row.amountPaise,
        )
      : [];

  const setSearch = (next: SearchRange) =>
    void navigate({ replace: true, search: (previous) => ({ ...previous, ...next }) });

  return (
    <>
      <ListToolbar>
        <PeriodMenu range={range} onChange={setSearch} />
        <ReportDownloads
          orgSlug={orgSlug}
          build={() => orpc.export.partyStatementXlsx.call({ orgSlug, partyId, ...range })}
          failure="Could not build the party statement"
          pdf={linkOptions({
            to: "/api/$orgSlug/parties/$partyId/statement/pdf",
            params: { orgSlug, partyId },
            search: range,
          })}
        />
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
