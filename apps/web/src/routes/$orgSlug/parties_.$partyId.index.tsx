import { formatMoney } from "@accly/api/core/money";
import { Separator } from "@accly/ui/components/separator";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { balanceLabel } from "@/components/ledger-columns";
import { PartyFactSections, RecentReceipts } from "@/components/party-facts";
import { useCan } from "@/lib/membership";
import { formatDay } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { partyStatementOptions, partyTotalsOptions } from "@/lib/parties";

export const Route = createFileRoute("/$orgSlug/parties_/$partyId/")({
  component: PartyOverview,
});

function Summary({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-border p-4 not-last:border-b sm:not-last:border-r sm:not-last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{children}</dd>
    </div>
  );
}

function PartyOverview() {
  const { orgSlug, partyId } = Route.useParams();
  const canReadReceipts = useCan(orgSlug, { receipt: ["read"] });
  const canReadLedger = useCan(orgSlug, { report: ["read"] });

  const party = useSuspenseQuery(orpc.party.get.queryOptions({ input: { orgSlug, partyId } })).data;
  const totals = useQuery({ ...partyTotalsOptions(orgSlug), enabled: canReadReceipts });

  const statement = useQuery({
    ...partyStatementOptions(orgSlug, partyId),
    enabled: canReadLedger,
  });

  // Sparse: a party with no posted receipt has no totals row. Nothing stands in while
  // a figure loads.
  const own = totals.data?.find((row) => row.partyId === partyId);
  const received = totals.data ? formatMoney(own?.receivedPaise ?? 0n) : null;

  return (
    <div className="grid w-full max-w-4xl gap-6">
      {canReadReceipts || canReadLedger ? (
        <dl className="grid overflow-clip rounded-lg border border-border bg-card sm:grid-cols-4">
          {canReadReceipts ? (
            <>
              <Summary label="Received">{received}</Summary>
              <Summary label="Receipts">{totals.data ? (own?.receiptCount ?? 0) : null}</Summary>
              <Summary label="Last receipt">
                {totals.data ? (own ? formatDay(own.lastReceiptDate) : "—") : null}
              </Summary>
            </>
          ) : null}
          {canReadLedger ? (
            <Summary label="Balance">
              {statement.data ? balanceLabel(statement.data.closingPaise) : null}
            </Summary>
          ) : null}
        </dl>
      ) : null}

      <div className="grid gap-4">
        <PartyFactSections party={party} />
        {canReadReceipts ? (
          <>
            <Separator />
            <RecentReceipts orgSlug={orgSlug} partyId={partyId} />
          </>
        ) : null}
      </div>
    </div>
  );
}
