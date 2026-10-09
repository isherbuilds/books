import { documentLabel } from "@accly/api/lib/document-labels";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@accly/ui/components/form";
import { ToggleGroup, ToggleGroupItem } from "@accly/ui/components/toggle-group";
import { skipToken, useInfiniteQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useFormContext } from "react-hook-form";

import {
  AllocationTable,
  SettlementAllocationTotals,
  checkAllocations,
  reportRowErrors,
  settlementCapacity,
  settlementRemaining,
  type OpenDocument,
} from "@/components/allocation-table";
import { openCreditsOptions, openItemsOptions } from "@/lib/pickers";

/**
 * How a Receipt or Payment settles. A refund is money back on the other side: a
 * supplier's refund on a Receipt, a customer's on a Payment.
 */
const MODES = ["advance", "against", "direct", "refund"] as const;

type SettlementMode = (typeof MODES)[number];

type Side = "receivable" | "payable";

// The credits a refund pays out: a supplier's debit notes and advances, a customer's
// credit notes.
const REFUND_CREDITS = {
  payable: ["debitNote", "payment"],
  receivable: ["creditNote"],
} satisfies Record<Side, ("debitNote" | "payment" | "creditNote")[]>;

const REFUND_COPY = {
  payable: { title: "What this supplier owes you", heading: "Owed to you" },
  receivable: { title: "What you owe this customer", heading: "Owed to them" },
};

type SettlementValues = {
  mode: SettlementMode;
  amount: string;
  allocations: Record<string, string>;
} & Partial<Record<AdjustmentsName, { amount: string }[]>>;

type AdjustmentsName = "adjustments" | "writeOffs";

/**
 * The open documents a settlement allocates to: the party's claims on `claimSide`
 * against open items, or the credits on the other side for a refund.
 */
export function useOpenDocuments(
  orgSlug: string,
  partyId: string | null | undefined,
  mode: SettlementMode,
  claimSide: Side,
) {
  const refund = mode === "refund";
  const side: Side = refund ? (claimSide === "receivable" ? "payable" : "receivable") : claimSide;

  const items = useInfiniteQuery(
    openItemsOptions(mode === "against" && partyId ? { orgSlug, partyId, side } : skipToken),
  );

  const credits = useInfiniteQuery(
    openCreditsOptions(
      refund && partyId ? { orgSlug, partyId, side, types: REFUND_CREDITS[side] } : skipToken,
    ),
  );

  const rows: OpenDocument[] = refund
    ? (credits.data?.pages
        .flatMap((page) => page.rows)
        .map((row) => ({
          ...row,
          label: documentLabel(row.type, side),
          dueDate: null,
          openPaise: row.unappliedPaise,
        })) ?? [])
    : (items.data?.pages
        .flatMap((page) => page.rows)
        .map((row) => ({
          ...row,
          label: documentLabel(row.type, side),
          openPaise: row.outstandingPaise,
        })) ?? []);

  return {
    refund,
    side,
    partyRole: side === "receivable" ? ("customer" as const) : ("vendor" as const),
    query: refund ? credits : items,
    rows,
  };
}

type OpenDocuments = ReturnType<typeof useOpenDocuments>;

/** Picks the mode; allocations belong to one mode's documents, so a change clears them. */
export function SettlementModeField({
  canAgainst,
  canRefund,
  refundLabel,
}: {
  canAgainst: boolean;
  canRefund: boolean;
  refundLabel: string;
}) {
  const form = useFormContext<SettlementValues>();

  return (
    <FormField
      control={form.control}
      name="mode"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Settlement kind</FormLabel>
          <FormControl>
            <ToggleGroup
              value={[field.value]}
              onValueChange={(next) => {
                const mode = MODES.find((option) => option === next[0]);

                if (mode) {
                  form.setValue("allocations", {});
                  field.onChange(mode);
                }
              }}
              spacing={1}
              variant="outline"
              aria-label="Settlement kind"
              className="flex-wrap"
            >
              <ToggleGroupItem value="advance">Advance</ToggleGroupItem>
              {canAgainst ? (
                <ToggleGroupItem value="against">Against open items</ToggleGroupItem>
              ) : null}
              <ToggleGroupItem value="direct">Direct</ToggleGroupItem>
              {canRefund ? <ToggleGroupItem value="refund">{refundLabel}</ToggleGroupItem> : null}
            </ToggleGroup>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** The open documents with Allocated and Remaining; adjustments widen what a non-refund allocates. */
export function OpenDocumentsTable({
  open,
  adjustmentsName,
  advanceField,
}: {
  open: OpenDocuments;
  adjustmentsName: AdjustmentsName;
  advanceField?: ReactNode;
}) {
  const form = useFormContext<SettlementValues>();
  const adjustments = open.refund ? null : adjustmentsName;

  return (
    <AllocationTable
      title={open.refund ? REFUND_COPY[open.side].title : "Open items"}
      openHeading={open.refund ? REFUND_COPY[open.side].heading : "Outstanding"}
      query={open.query}
      rows={open.rows}
      name="allocations"
      remainingFor={(documentId) =>
        settlementRemaining(
          form.getValues("amount"),
          form.getValues("allocations"),
          (adjustments && form.getValues(adjustments)) ?? [],
          documentId,
        )
      }
    >
      <SettlementAllocationTotals adjustmentsName={adjustments} advanceField={advanceField} />
    </AllocationTable>
  );
}

type SetAllocationError = (
  name: "allocations" | `allocations.${string}`,
  error: { message: string },
  options?: { shouldFocus: boolean },
) => void;

/**
 * The allocations to post, or null once the refusal is on the form. A refund allocates
 * exactly its amount; otherwise the amount and adjustments bound what is allocated, in
 * full when adjusted, and `partial` says a remainder posts as an advance.
 */
export function allocationsToPost(
  setError: SetAllocationError,
  open: OpenDocuments,
  values: { amount: string; allocations: Record<string, string> },
  adjustments: readonly { amount: string }[],
) {
  if (!open.query.isSuccess || open.query.isFetching) {
    setError("allocations", { message: "Wait for the open documents to load" });

    return null;
  }

  const { selected, allocatedPaise, rowErrors, tableError } = checkAllocations(
    values.allocations,
    open.rows,
  );

  if (reportRowErrors(setError, rowErrors)) return null;

  const capacityPaise = settlementCapacity(values.amount, adjustments);

  const message =
    tableError ??
    (open.refund
      ? allocatedPaise === capacityPaise
        ? undefined
        : "Amount must match the total you picked below"
      : allocatedPaise > capacityPaise
        ? "Allocated amount cannot exceed the amount and adjustments"
        : adjustments.length > 0 && allocatedPaise !== capacityPaise
          ? "Allocate the full amount and adjustments"
          : undefined);

  if (message) {
    setError("allocations", { message });

    return null;
  }

  return { selected, partial: allocatedPaise < capacityPaise };
}
