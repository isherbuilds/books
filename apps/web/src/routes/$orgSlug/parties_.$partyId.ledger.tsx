import { formatBalance } from "@accly/api/core/money";
import { Button } from "@accly/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@accly/ui/components/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { ClientOnly, createFileRoute, useNavigate } from "@tanstack/react-router";
import { CalendarIcon, ChevronDownIcon } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";

import { DataTable } from "@/components/data-table/data-table";
import { TableEmpty } from "@/components/data-table/table-empty";
import { LEDGER_COLUMNS, LedgerCard } from "@/components/ledger-columns";
import { DateRangePopover, PresetItems } from "@/components/list-filter";
import { ListToolbar } from "@/components/page";
import { rangeLabel, type SearchRange } from "@/lib/date-presets";
import { useOrgDateTime } from "@/lib/org-datetime";
import { partyStatementOptions } from "@/lib/parties";

const ledgerSearch = z.object({
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
});

export const Route = createFileRoute("/$orgSlug/parties_/$partyId/ledger")({
  validateSearch: ledgerSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ context: { queryClient }, deps, params: { orgSlug, partyId } }) => {
    await queryClient.query(partyStatementOptions(orgSlug, partyId, deps)).catch(() => {});
  },
  component: PartyLedger,
});

// The party's statement of account: every posted exposure line with a running balance,
// Dr when the party owes the organization and Cr for an advance held.
function PartyLedger() {
  const { orgSlug, partyId } = Route.useParams();
  const range: SearchRange = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { today, financialYearStart } = useOrgDateTime();
  const trigger = useRef<HTMLButtonElement>(null);
  const [customRangeOpen, setCustomRangeOpen] = useState(false);

  const statement = useQuery(partyStatementOptions(orgSlug, partyId, range));
  const lines = statement.data?.lines ?? [];

  const setSearch = (next: SearchRange) =>
    void navigate({ replace: true, search: (previous) => ({ ...previous, ...next }) });

  const label = rangeLabel(range, today, financialYearStart);

  const periodTrigger = (
    <Button ref={trigger} variant="outline">
      <CalendarIcon data-icon="inline-start" />
      {label}
      <ChevronDownIcon data-icon="inline-end" />
    </Button>
  );

  return (
    <>
      <ListToolbar>
        <ClientOnly fallback={periodTrigger}>
          <DropdownMenu>
            <DropdownMenuTrigger render={periodTrigger} />
            <DropdownMenuContent className="p-1">
              <PresetItems
                range={range}
                today={today}
                financialYearStart={financialYearStart}
                onSelect={setSearch}
                onCustom={() => setCustomRangeOpen(true)}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </ClientOnly>
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
        rowLink={(line) => ({
          to: "/$orgSlug/receipts/$receiptId",
          params: { orgSlug, receiptId: line.documentId },
          search: { partyId },
        })}
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

      <DateRangePopover
        open={customRangeOpen}
        onOpenChange={setCustomRangeOpen}
        anchor={trigger}
        from={range.from}
        to={range.to}
        today={today}
        onApply={setSearch}
      />
    </>
  );
}
