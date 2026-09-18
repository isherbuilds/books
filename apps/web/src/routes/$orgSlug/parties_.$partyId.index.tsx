import { ZERO_MONEY, formatBalance, formatMoney } from "@accly/api/core/money";
import { authorize } from "@accly/auth/access";
import { Separator } from "@accly/ui/components/separator";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { PartyFactSections, RecentReceipts } from "@/components/party-facts";
import { membershipOptions, useCan } from "@/lib/membership";
import { orpc } from "@/lib/orpc";
import { partyStatementOptions, partyTotalsOptions } from "@/lib/parties";

export const Route = createFileRoute("/$orgSlug/parties_/$partyId/")({
  // The figures start here so they ride `party.get`'s batch; neither blocks the page,
  // since a statement over a long history must not hold the record back.
  loader: async ({ context: { queryClient }, params: { orgSlug, partyId } }) => {
    const { roles } = await queryClient.query(membershipOptions(orgSlug));

    if (authorize(roles, { receipt: ["read"] })) {
      void queryClient.query(partyTotalsOptions(orgSlug, partyId)).catch(() => {});
    }

    if (authorize(roles, { report: ["read"] })) {
      void queryClient.query(partyStatementOptions(orgSlug, partyId)).catch(() => {});
    }
  },
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
  const totals = useQuery({ ...partyTotalsOptions(orgSlug, partyId), enabled: canReadReceipts });

  const statement = useQuery({
    ...partyStatementOptions(orgSlug, partyId),
    enabled: canReadLedger,
  });

  // At most this party's row, and none without a posted receipt. Nothing stands in
  // while a figure loads.
  const own = totals.data?.[0];
  const received = totals.data ? formatMoney(own?.receivedPaise ?? ZERO_MONEY) : null;

  return (
    <div className="grid w-full max-w-4xl gap-6">
      {canReadReceipts || canReadLedger ? (
        <dl className="grid overflow-clip rounded-lg border border-border bg-card sm:grid-cols-2">
          {canReadReceipts ? <Summary label="Received">{received}</Summary> : null}
          {canReadLedger ? (
            <Summary label="Balance">
              {statement.data ? formatBalance(statement.data.closingPaise) : null}
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
