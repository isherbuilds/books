import { formatBusinessDay } from "@accly/api/lib/business-date";
import type { RefusalReason } from "@accly/api/lib/conflict";
import {
  NON_NEGATIVE_MONEY_PATTERN,
  ZERO_MONEY,
  enteredPaise,
  formatDecimal,
  formatMoney,
  isPositiveMoney,
  isZeroMoney,
} from "@accly/api/core/money";
import { Button } from "@accly/ui/components/button";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@accly/ui/components/form";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@accly/ui/components/table";
import type { UseInfiniteQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { AmountInput } from "@/components/amount-input";
import { LineGrid } from "@/components/document-form";
import { ErrorNote, ListFooter } from "@/components/page";
import { WaveLoader } from "@/components/wave-loader";
import type { ServerReason } from "@/lib/orpc-error";

/** Refusals that mean the shown open documents are stale. */
export const ALLOCATION_REFUSALS: ReadonlySet<ServerReason | undefined> = new Set<RefusalReason>([
  "ALLOCATION_TARGET_INVALID",
  "ALLOCATION_SOURCE_INVALID",
  "ALLOCATION_EXCEEDS_OUTSTANDING",
  "ALLOCATION_EXCEEDS_SOURCE",
]);

/** An open claim or credit a settlement can allocate to, with what is still open on it. */
export type OpenDocument = {
  id: string;
  label: string;
  number: string;
  reference: string | null;
  documentDate: string;
  dueDate: string | null;
  openPaise: bigint;
};

type AllocationValues = {
  allocations: Record<string, string>;
  lines: { allocations: Record<string, string> }[];
};

type SettlementValues = {
  amount: string;
  allocations: Record<string, string>;
} & Partial<Record<"adjustments" | "writeOffs", { amount: string }[]>>;

type AllocationPath = "allocations" | `lines.${number}.allocations`;

type AdjustmentsName = "adjustments" | "writeOffs";

export const sumEntered = (amounts: readonly string[]) =>
  amounts.reduce((total, amount) => total + enteredPaise(amount), ZERO_MONEY);

/** What a settlement can allocate as typed: its amount and its adjustments. */
export const settlementCapacity = (amount: string, adjustments: readonly { amount: string }[]) =>
  enteredPaise(amount) + sumEntered(adjustments.map((row) => row.amount));

export function settlementRemaining(
  amount: string,
  allocations: Record<string, string>,
  adjustments: readonly { amount: string }[],
  documentId: string,
) {
  return (
    settlementCapacity(amount, adjustments) -
    sumEntered(
      Object.entries(allocations).flatMap(([id, value]) => (id === documentId ? [] : [value])),
    )
  );
}

/**
 * The typed amounts that allocate to open documents, the refusals for the rest, and a
 * refusal for the table as a whole. Pure, so a submit and a test read the same rules.
 */
export function checkAllocations(
  entered: Record<string, string>,
  rows: readonly OpenDocument[],
): {
  selected: { id: string; amount: string }[];
  allocatedPaise: bigint;
  rowErrors: { id: string; message: string }[];
  tableError: string | undefined;
} {
  const selected: { id: string; amount: string }[] = [];
  const rowErrors: { id: string; message: string }[] = [];
  let allocatedPaise = ZERO_MONEY;

  for (const [id, amount] of Object.entries(entered)) {
    if (!amount) continue;

    const row = rows.find((candidate) => candidate.id === id);
    const paise = enteredPaise(amount);

    const message = !row
      ? "This document is no longer open. Clear the amount to continue."
      : !NON_NEGATIVE_MONEY_PATTERN.test(amount) || isZeroMoney(paise)
        ? "Enter a positive amount"
        : paise > row.openPaise
          ? `Enter no more than ${formatMoney(row.openPaise)}`
          : undefined;

    if (message) {
      rowErrors.push({ id, message });
    } else {
      selected.push({ id, amount });
      // oxlint-disable-next-line accly/no-paise-arithmetic-in-components -- input maths on typed amounts inside the named validator
      allocatedPaise += paise;
    }
  }

  const tableError =
    rowErrors.length > 0
      ? undefined
      : selected.length === 0
        ? "Allocate to at least one document"
        : selected.length > 50
          ? "Allocate to no more than 50 documents"
          : undefined;

  return { selected, allocatedPaise, rowErrors, tableError };
}

/** Marks each refused row, focusing the first; true when any row was refused. */
export function reportRowErrors(
  setError: (
    name: `allocations.${string}`,
    error: { message: string },
    options: { shouldFocus: boolean },
  ) => void,
  rowErrors: readonly { id: string; message: string }[],
): boolean {
  rowErrors.forEach(({ id, message }, index) =>
    setError(`allocations.${id}`, { message }, { shouldFocus: index === 0 }),
  );

  if (rowErrors.length > 0) toast.error("Check the allocated amounts before posting.");

  return rowErrors.length > 0;
}

function UnavailableAllocations({
  rows,
  allocationPath,
}: {
  rows: readonly OpenDocument[];
  allocationPath: AllocationPath;
}) {
  const form = useFormContext<AllocationValues>();
  const allocations = useWatch({ control: form.control, name: allocationPath });
  const openIds = new Set(rows.map((row) => row.id));

  const unavailableIds = Object.entries(allocations)
    .filter(([id, amount]) => amount && !openIds.has(id))
    .map(([id]) => id);

  if (unavailableIds.length === 0) return null;

  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-destructive">A selected document is no longer open.</p>
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={() => {
          for (const id of unavailableIds) {
            form.setValue(`${allocationPath}.${id}`, "");
            form.clearErrors(`${allocationPath}.${id}`);
          }
        }}
      >
        Clear unavailable
      </Button>
    </div>
  );
}

/**
 * Allocated and remaining, subscribed apart from the rows so typing re-renders only this.
 * A refund (no adjustments field) and an adjusted settlement allocate in full; any
 * other remainder posts as an advance.
 */
export function SettlementAllocationTotals({
  adjustmentsName,
  advanceField,
}: {
  adjustmentsName: AdjustmentsName | null;
  advanceField?: ReactNode;
}) {
  const { control } = useFormContext<SettlementValues>();
  const amount = useWatch({ control, name: "amount" });
  const allocations = useWatch({ control, name: "allocations" });
  const adjustments = useWatch({ control, name: adjustmentsName ?? "adjustments" });

  const allocatedPaise = sumEntered(Object.values(allocations));

  const remainingPaise =
    // oxlint-disable-next-line accly/no-paise-arithmetic-in-components -- live remainder of the typed amount, recomputed per keystroke
    settlementCapacity(amount, adjustmentsName ? (adjustments ?? []) : []) - allocatedPaise;

  const asAdvance = adjustmentsName !== null && (adjustments?.length ?? 0) === 0;

  return (
    <>
      <dl className="grid gap-1 border-t border-border pt-2">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">Allocated</dt>
          <dd className="tabular-nums">{formatMoney(allocatedPaise)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 font-medium">
          <dt>
            {remainingPaise < ZERO_MONEY
              ? "Over by"
              : asAdvance
                ? "Remaining as advance"
                : "Remaining to allocate"}
          </dt>
          <dd className="tabular-nums">
            {formatMoney(remainingPaise < ZERO_MONEY ? -remainingPaise : remainingPaise)}
          </dd>
        </div>
      </dl>
      {asAdvance && isPositiveMoney(remainingPaise) ? advanceField : null}
    </>
  );
}

/**
 * A party's open documents, oldest first with Load more, each with an amount field,
 * then the totals. Amounts are keyed by document, so they survive loading more pages.
 * Fill enters what is left of the settlement, capped at what is open on the row.
 */
export function AllocationTable({
  title,
  openHeading,
  query,
  rows,
  name,
  remainingFor,
  children,
}: {
  title: string;
  openHeading: string;
  query: Pick<
    UseInfiniteQueryResult,
    | "isPending"
    | "isError"
    | "isSuccess"
    | "isFetching"
    | "error"
    | "isFetchNextPageError"
    | "hasNextPage"
    | "isFetchingNextPage"
    | "fetchNextPage"
  >;
  rows: readonly OpenDocument[];
  name: AllocationPath;
  remainingFor: (documentId: string) => bigint;
  children: ReactNode;
}) {
  const form = useFormContext<AllocationValues>();

  const fill = (row: OpenDocument) => {
    const remainder = remainingFor(row.id);

    form.setValue(
      `${name}.${row.id}`,
      remainder > ZERO_MONEY
        ? formatDecimal(remainder < row.openPaise ? remainder : row.openPaise)
        : "",
      { shouldValidate: true },
    );
    form.clearErrors(name);
  };

  return (
    <>
      <FormField
        control={form.control}
        name={name}
        render={() => (
          <FormItem>
            <LineGrid title={title}>
              {query.isPending ? (
                <WaveLoader label="Loading open documents" />
              ) : query.isError && !query.isFetchNextPageError ? (
                <ErrorNote title="Could not load open documents" error={query.error} />
              ) : rows.length === 0 ? (
                <p className="text-muted-foreground">No open documents.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Document</TableHead>
                      <TableHead className="hidden text-right sm:table-cell">
                        {openHeading}
                      </TableHead>
                      <TableHead className="w-52 text-right">Allocate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-normal">
                          <p className="font-mono">
                            <span className="font-sans text-muted-foreground">{row.label} · </span>
                            {row.number}
                            {row.reference ? (
                              <span className="font-sans text-muted-foreground">
                                {" "}
                                · {row.reference}
                              </span>
                            ) : null}
                          </p>
                          <p className="text-muted-foreground tabular-nums">
                            {formatBusinessDay(row.documentDate)}
                            {row.dueDate ? ` · Due ${formatBusinessDay(row.dueDate)}` : null}
                          </p>
                          {/* Phones drop the amount column, so the amount input keeps its width. */}
                          <p className="tabular-nums sm:hidden">
                            {openHeading} {formatMoney(row.openPaise)}
                          </p>
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums sm:table-cell">
                          {formatMoney(row.openPaise)}
                        </TableCell>
                        <TableCell className="w-52">
                          <RegisteredFormField
                            name={`${name}.${row.id}`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="sr-only">Amount for {row.number}</FormLabel>
                                <div className="flex min-w-48 items-center gap-1">
                                  <FormControl>
                                    <AmountInput {...field} className="h-7" />
                                  </FormControl>
                                  <Button
                                    type="button"
                                    size="xs"
                                    variant="ghost"
                                    aria-label={`Fill allocation for ${row.number}`}
                                    onClick={() => fill(row)}
                                  >
                                    Fill
                                  </Button>
                                </div>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {query.isSuccess && !query.isFetching ? (
                <UnavailableAllocations rows={rows} allocationPath={name} />
              ) : null}
              <ListFooter query={query} shown={rows.length} manual />
            </LineGrid>
            <FormMessage />
          </FormItem>
        )}
      />
      {children}
    </>
  );
}
