import { Button } from "@accly/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@accly/ui/components/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { ClientOnly, createFileRoute, useNavigate } from "@tanstack/react-router";
import { CalendarIcon, ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { DataTable } from "@/components/data-table/data-table";
import { TableEmpty } from "@/components/data-table/table-empty";
import { LEDGER_COLUMNS, LedgerCard, balanceLabel } from "@/components/ledger-columns";
import { DateFilterItems, DateRangeDialog } from "@/components/list-filter";
import { ListToolbar } from "@/components/page";
import { dateRangeLabel } from "@/lib/date-presets";
import { useOrgDateTime } from "@/lib/org-datetime";
import { partyStatementOptions } from "@/lib/parties";

type Period = { from?: string; to?: string };

export const Route = createFileRoute("/$orgSlug/parties_/$partyId/ledger")({
  validateSearch: z.object({
    from: z.iso.date().optional().catch(undefined),
    to: z.iso.date().optional().catch(undefined),
  }),
  loaderDeps: ({ search: { from, to } }) => ({ from, to }),
  loader: async ({ context: { queryClient }, deps, params: { orgSlug, partyId } }) => {
    await queryClient.query(partyStatementOptions(orgSlug, partyId, deps)).catch(() => {});
  },
  component: PartyLedger,
});

function PeriodMenu({
  today,
  period,
  onChange,
  onCustom,
}: {
  today: string;
  period: Period;
  onChange: (period: Period) => void;
  onCustom: () => void;
}) {
  const label = dateRangeLabel(today, period.from, period.to);

  const trigger = (
    <Button variant="outline">
      <CalendarIcon data-icon="inline-start" />
      {label}
      <ChevronDownIcon data-icon="inline-end" />
    </Button>
  );

  return (
    <ClientOnly fallback={trigger}>
      <DropdownMenu>
        <DropdownMenuTrigger render={trigger} />
        <DropdownMenuContent className="p-1">
          <DropdownMenuCheckboxItem
            checked={!period.from && !period.to}
            onCheckedChange={() => onChange({ from: undefined, to: undefined })}
          >
            All time
          </DropdownMenuCheckboxItem>
          <DateFilterItems
            today={today}
            from={period.from}
            to={period.to}
            onChange={onChange}
            onCustom={onCustom}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </ClientOnly>
  );
}

// The party's statement of account: every posted exposure line with a running balance,
// Dr when the party owes the organization and Cr for an advance held.
function PartyLedger() {
  const { orgSlug, partyId } = Route.useParams();
  const period = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { today } = useOrgDateTime();
  const [customRangeOpen, setCustomRangeOpen] = useState(false);
  const statement = useQuery(partyStatementOptions(orgSlug, partyId, period));
  const lines = statement.data?.lines ?? [];

  const setPeriod = (next: Period) =>
    void navigate({ replace: true, search: (previous) => ({ ...previous, ...next }) });

  return (
    <>
      <ListToolbar>
        <PeriodMenu
          today={today}
          period={period}
          onChange={setPeriod}
          onCustom={() => setCustomRangeOpen(true)}
        />
        {statement.data ? (
          <p className="ml-auto flex items-baseline gap-4 text-muted-foreground">
            {period.from ? (
              <span>
                Opening{" "}
                <span className="text-foreground tabular-nums">
                  {balanceLabel(statement.data.openingPaise)}
                </span>
              </span>
            ) : null}
            <span>
              Closing{" "}
              <span className="font-medium text-foreground tabular-nums">
                {balanceLabel(statement.data.closingPaise)}
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
              period.from || period.to
                ? "Nothing was posted for this party in the period."
                : "Advances, invoices and their settlements for this party appear here."
            }
          />
        }
      />

      <DateRangeDialog
        open={customRangeOpen}
        onOpenChange={setCustomRangeOpen}
        from={period.from}
        to={period.to}
        onApply={setPeriod}
      />
    </>
  );
}
