// Copyright (c) Midday Labs AB, AGPL-3.0, from midday-ai/midday@51587319f26a0ffaa9dfccab1920373cb65689b7
// Adapted from apps/dashboard/src/components/customer-details.tsx (fact grid and the
// invoice list inside the customer sheet).
import { formatBusinessDay } from "@accly/api/lib/business-date";
import { formatMoney } from "@accly/api/core/money";
import { INDIAN_STATES } from "@accly/api/lib/indian-states";
import type { PartyRecord } from "@accly/api/routers/party";
import { Badge } from "@accly/ui/components/badge";
import { buttonVariants } from "@accly/ui/components/button";
import { Separator } from "@accly/ui/components/separator";
import { cn } from "@accly/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { struck } from "@/components/document-columns";
import { ErrorNote } from "@/components/page";
import { Section } from "@/components/party-form";

import { orpc } from "@/lib/orpc";

function Fact({
  label,
  children,
  wide,
  mono,
  empty = "—",
}: {
  label: string;
  children?: ReactNode;
  wide?: boolean;
  mono?: boolean;
  empty?: string;
}) {
  return (
    <div className={cn("grid gap-1", wide && "col-span-2")}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("wrap-anywhere", children ? mono && "font-mono" : "text-muted-foreground")}>
        {children || empty}
      </dd>
    </div>
  );
}

/** Contact, tax and address facts, split by hairlines: the quick look and the Overview tab. */
export function PartyFactSections({ party }: { party: PartyRecord }) {
  const state = INDIAN_STATES[party.stateCode];
  const address = [party.addressLine1, party.addressLine2].filter(Boolean).join(", ");

  return (
    <>
      <Section title="Contact">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Fact label="Phone">{party.phone}</Fact>
          <Fact label="Email">{party.email}</Fact>
        </dl>
      </Section>

      <Separator />

      <Section title="Tax">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Fact label="GSTIN" mono empty="Unregistered">
            {party.gstin}
          </Fact>
          <Fact label="PAN" mono>
            {party.pan}
          </Fact>
          <Fact label="State" wide>
            {party.stateCode}
            {state ? ` — ${state}` : ""}
          </Fact>
        </dl>
      </Section>

      <Separator />

      <Section title="Address">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Fact label="Address" wide>
            {address}
          </Fact>
          <Fact label="City">{party.city}</Fact>
          <Fact label="PIN code" mono>
            {party.pinCode}
          </Fact>
        </dl>
      </Section>
    </>
  );
}

/** The last five receipts, each opening its record Sheet over a list filtered to the party. */
export function RecentReceipts({ orgSlug, partyId }: { orgSlug: string; partyId: string }) {
  const receipts = useQuery(
    orpc.receipt.list.queryOptions({ input: { orgSlug, partyId, limit: 5 } }),
  );

  const rows = receipts.data?.rows ?? [];

  return (
    <Section
      title="Recent receipts"
      action={
        rows.length > 0 ? (
          <Link
            to="/$orgSlug/parties/$partyId/receipts"
            params={{ orgSlug, partyId }}
            className={buttonVariants({ variant: "ghost", size: "xs" })}
          >
            All receipts
          </Link>
        ) : null
      }
    >
      {receipts.isError ? (
        <ErrorNote title="Could not load receipts" error={receipts.error} />
      ) : null}
      {receipts.isSuccess && rows.length === 0 ? (
        <p className="text-muted-foreground">No receipts from this party yet.</p>
      ) : null}
      {rows.length > 0 ? (
        <ul className="divide-y divide-border border-y border-border">
          {rows.map((receipt) => {
            const cancelled = receipt.state === "cancelled";

            return (
              <li key={receipt.id}>
                <Link
                  to="/$orgSlug/receipts/$receiptId"
                  params={{ orgSlug, receiptId: receipt.id }}
                  search={{ partyId }}
                  className="grid grid-cols-[auto_1fr_auto] items-baseline gap-3 py-2 hover:bg-muted/50"
                >
                  <span className="font-mono">{receipt.number}</span>
                  <span className="min-w-0 text-muted-foreground">
                    {formatBusinessDay(receipt.documentDate)}
                    {cancelled ? (
                      <Badge variant="muted" className="ml-2">
                        Cancelled
                      </Badge>
                    ) : null}
                  </span>
                  <span className={cn("text-right tabular-nums", struck(receipt.state))}>
                    {formatMoney(receipt.totalPaise)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Section>
  );
}
