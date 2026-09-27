import { formatBalance } from "@accly/api/core/money";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { DataTable } from "@/components/data-table/data-table";
import { TableEmpty } from "@/components/data-table/table-empty";
import { LEDGER_COLUMNS, LedgerCard } from "@/components/ledger-columns";
import { PeriodMenu } from "@/components/date-range-filter";
import { ListToolbar } from "@/components/page";
import type { SearchRange } from "@/lib/date-presets";
import { partyDocumentLink, partyStatementOptions } from "@/lib/parties";
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
    await queryClient.prefetchQuery(partyStatementOptions(orgSlug, partyId, deps));
  },
  component: PartyLedger,
});

// The party's statement of account: every posted exposure line with a running balance,
// Dr when the party owes the organization and Cr for an advance held.
function PartyLedger() {
  const { orgSlug, partyId } = Route.useParams();
  const { all: _all, ...range } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const statement = useQuery(partyStatementOptions(orgSlug, partyId, range));
  const lines = statement.data?.lines ?? [];

  const setSearch = (next: SearchRange) =>
    void navigate({ replace: true, search: (previous) => ({ ...previous, ...next }) });

  return (
    <>
      <ListToolbar>
        <PeriodMenu range={range} onChange={setSearch} />
        {statement.data ? (
          <p className="ml-auto flex items-baseline gap-4 text-muted-foreground">
            {range.from ? (
              <span>
                Opening{" "}
                <span className="text-foreground tabular-nums">
                  {formatBalance(statement.data.openingPaise)}
                </span>
              </span>
            ) : null}
            <span>
              Closing{" "}
              <span className="font-medium text-foreground tabular-nums">
                {formatBalance(statement.data.closingPaise)}
              </span>
            </span>
          </p>
        ) : null}
      </ListToolbar>

      <DataTable
        columns={LEDGER_COLUMNS}
        data={lines}
        getRowId={(line) => line.id}
        meta={{ orgSlug }}
        rowLink={(line) => partyDocumentLink(orgSlug, partyId, line.documentType, line.documentId)}
        renderCard={(line) => <LedgerCard line={line} />}
        query={statement}
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
    </>
  );
}
