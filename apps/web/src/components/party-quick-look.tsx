// Copyright (c) Midday Labs AB, AGPL-3.0, from midday-ai/midday@51587319f26a0ffaa9dfccab1920373cb65689b7
// Adapted from apps/dashboard/src/components/sheets/customer-details-sheet.tsx.
import type { PartyRecord } from "@accly/api/routers/party";
import { Badge } from "@accly/ui/components/badge";
import { buttonVariants } from "@accly/ui/components/button";
import { Separator } from "@accly/ui/components/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@accly/ui/components/sheet";
import { ClientOnly, Link } from "@tanstack/react-router";

import { Monogram } from "@/components/monogram";
import { PartyFactSections, RecentReceipts } from "@/components/party-facts";
import { useCan } from "@/lib/membership";
import { ROLE_LABELS } from "@/lib/parties";
import { stepRow } from "@/lib/row-focus";

/**
 * A read-only look at a party from the list, which stays mounted behind it. The row
 * from the cached master carries every field, so opening it costs no request; the
 * party page owns editing, receipts and the ledger.
 */
export function PartyQuickLook({
  orgSlug,
  party,
  onClose,
  onStep,
}: {
  orgSlug: string;
  party: PartyRecord;
  onClose: () => void;
  onStep: (partyId: string) => void;
}) {
  const canUpdate = useCan(orgSlug, { party: ["update"] });
  const canReadReceipts = useCan(orgSlug, { receipt: ["read"] });

  return (
    <ClientOnly fallback={null}>
      <Sheet open onOpenChange={(open) => !open && onClose()}>
        <SheetContent onKeyDown={(event) => stepRow(event, party.id, onStep)}>
          <SheetHeader>
            <div className="flex min-w-0 items-center gap-2">
              <Monogram label={party.name} tone="accent" />
              <SheetTitle className="min-w-0 truncate">{party.name}</SheetTitle>
            </div>
            <SheetDescription className="flex flex-wrap items-center gap-1">
              {party.roles.map((role) => (
                <Badge key={role} variant="outline">
                  {ROLE_LABELS[role]}
                </Badge>
              ))}
              {party.active ? null : <Badge variant="muted">Inactive</Badge>}
            </SheetDescription>
          </SheetHeader>

          <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4">
            <PartyFactSections party={party} />
            {canReadReceipts ? (
              <>
                <Separator />
                <RecentReceipts orgSlug={orgSlug} partyId={party.id} />
              </>
            ) : null}
          </div>

          <SheetFooter>
            {canUpdate ? (
              <Link
                to="/$orgSlug/parties/$partyId"
                params={{ orgSlug, partyId: party.id }}
                search={{ edit: true }}
                className={buttonVariants({ variant: "outline", className: "mr-auto" })}
              >
                Edit
              </Link>
            ) : null}
            <Link
              to="/$orgSlug/parties/$partyId"
              params={{ orgSlug, partyId: party.id }}
              className={buttonVariants()}
            >
              Open party
            </Link>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </ClientOnly>
  );
}
