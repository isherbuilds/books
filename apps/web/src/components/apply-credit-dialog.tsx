import type { AppPermission } from "@accly/auth/access";
import { formatBusinessDay } from "@accly/api/lib/business-date";
import { openingItemLabel } from "@accly/api/lib/opening-item-label";
import { AmountInput } from "@/components/amount-input";
import {
  enteredPaise,
  formatDecimal,
  formatMoney,
  isPositiveMoney,
  parseMoney,
} from "@accly/api/core/money";
import type { AppRouterClient } from "@accly/api/routers/index";
import { Button } from "@accly/ui/components/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@accly/ui/components/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@accly/ui/components/dialog";
import {
  Form,
  FormControl,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@accly/ui/components/form";

import { Label } from "@accly/ui/components/label";
import { SubmitButton } from "@accly/ui/components/submit-button";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ClientOnly } from "@tanstack/react-router";
import { CheckIcon } from "lucide-react";
import { useId, useState } from "react";
import { useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { WaveLoader } from "@/components/wave-loader";
import { useZodForm } from "@/hooks/use-zod-form";
import { invalidateSettlementState } from "@/lib/domain-invalidation";
import { orpc } from "@/lib/orpc";
import { applyOrpcFieldError, errorMessage, errorReason, handleWriteError } from "@/lib/orpc-error";
import { positiveAmount } from "@/lib/form-schema";
import { openCreditsOptions } from "@/lib/pickers";

type Credit = Awaited<ReturnType<AppRouterClient["party"]["openCredits"]>>["rows"][number];

// The last option while more credits exist; picking it loads the next page.
type LoadMoreRow = { loadMore: true };

const LOAD_MORE: LoadMoreRow = { loadMore: true };

const isLoadMore = (option: Credit | LoadMoreRow): option is LoadMoreRow => "loadMore" in option;

const creditLabel = (type: Credit["type"]) =>
  type === "creditNote"
    ? "Credit Note"
    : type === "debitNote"
      ? "Debit Note"
      : type === "payment"
        ? "Payment"
        : type === "openingCredit"
          ? openingItemLabel(type, null)
          : type === "journal"
            ? "Journal"
            : "Receipt";

/** What a reader needs to open this dialog: apply, and see the party's credits. */
export const APPLY_CREDIT_GRANT: AppPermission = {
  allocation: ["apply"],
  party: ["read"],
  note: ["read"],
};

const applyCreditSchema = z.object({
  amount: positiveAmount,
});

const smaller = (left: bigint, right: bigint) => (left < right ? left : right);

/** Mounted only while open, so every open starts with no credit and an empty amount. */
export function ApplyCreditDialog({
  orgSlug,
  side,
  target,
  onClose,
}: {
  orgSlug: string;
  side: "receivable" | "payable";
  target: { id: string; partyId: string; number: string; outstandingPaise: bigint };
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const creditInputId = useId();
  const [chosen, setChosen] = useState<Credit | null>(null);
  const [text, setText] = useState("");
  const form = useZodForm(applyCreditSchema, { defaultValues: { amount: "" } });
  const amount = useWatch({ control: form.control, name: "amount" });

  // Typed text searches numbers and references on the server; the picked credit's own number does not.
  const needle = chosen && text === chosen.number ? "" : text.trim();
  const q = useDebouncedValue(needle, 300);

  const credits = useInfiniteQuery(
    openCreditsOptions({ orgSlug, partyId: target.partyId, side, q: q || undefined }),
  );

  const rows = credits.data?.pages.flatMap((page) => page.rows) ?? [];
  const options: (Credit | LoadMoreRow)[] = credits.hasNextPage ? [...rows, LOAD_MORE] : rows;

  // The loaded row carries the latest unapplied amount; the kept one survives a search
  // that no longer lists it.
  const selected = rows.find((credit) => credit.id === chosen?.id) ?? chosen;
  const noCredits = credits.isSuccess && !q && !needle && rows.length === 0;

  const apply = useMutation(
    orpc.allocation.apply.mutationOptions({
      onSuccess: async () => {
        await invalidateSettlementState(queryClient, orgSlug);
        toast.success("Credit applied");
        onClose();
      },
      onError: (error) =>
        handleWriteError(error, {
          settle: () => {
            onClose();

            return invalidateSettlementState(queryClient, orgSlug);
          },
          fallback: "Could not apply the credit",
          uncertain: "The result is uncertain. Check the documents before applying it again.",
          refuse: async () => {
            const reason = errorReason(error);

            if (reason === "ALLOCATION_SOURCE_INVALID" || reason === "ALLOCATION_TARGET_INVALID") {
              onClose();
              await invalidateSettlementState(queryClient, orgSlug);
              toast.error(errorMessage(error, "Could not apply the credit"));

              return;
            }

            // The server states the amount that still fits; the refetched credit shows it too.
            await invalidateSettlementState(queryClient, orgSlug);
            applyOrpcFieldError(
              form,
              error,
              { ALLOCATION_EXCEEDS_SOURCE: "amount", ALLOCATION_EXCEEDS_OUTSTANDING: "amount" },
              "Could not apply the credit",
            );
          },
        }),
    }),
  );

  const pick = (option: Credit | LoadMoreRow) => {
    if (isLoadMore(option)) {
      if (!credits.isFetchingNextPage) void credits.fetchNextPage();

      return false;
    }

    setChosen(option);
    setText(option.number);
    form.clearErrors();
    form.setValue("amount", formatDecimal(smaller(option.unappliedPaise, target.outstandingPaise)));
    // After the list closes, so Enter in the amount applies the credit.
    requestAnimationFrame(() => form.setFocus("amount", { shouldSelect: true }));
  };

  const submit = form.handleSubmit(({ amount: entered }) => {
    if (!selected) return;

    const paise = parseMoney(entered);

    if (paise > selected.unappliedPaise || paise > target.outstandingPaise) {
      form.setError("amount", {
        message: `Enter no more than ${formatMoney(smaller(selected.unappliedPaise, target.outstandingPaise))}`,
      });

      return;
    }

    apply.mutate({
      orgSlug,
      sourceDocumentId: selected.id,
      targetDocumentId: target.id,
      amount: entered,
    });
  });

  const enteredAmount = enteredPaise(amount);

  const afterPaise =
    selected && isPositiveMoney(enteredAmount) && enteredAmount <= target.outstandingPaise
      ? target.outstandingPaise - enteredAmount
      : null;

  const emptyText =
    credits.isError && !credits.isFetchNextPageError
      ? "Could not load credits"
      : needle
        ? `No credits match “${needle}”`
        : "No unapplied credits";

  return (
    <ClientOnly fallback={null}>
      <Dialog open onOpenChange={(next) => !next && !apply.isPending && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply credit to {target.number}</DialogTitle>
            <DialogDescription className="tabular-nums">
              Outstanding {formatMoney(target.outstandingPaise)}
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form noValidate onSubmit={submit} className="flex flex-col gap-4">
              <fieldset disabled={apply.isPending} className="contents">
                {noCredits ? (
                  <p className="text-muted-foreground">No unapplied credits for this party.</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor={creditInputId}>Credit</Label>
                      <Combobox<Credit | LoadMoreRow>
                        items={options}
                        filteredItems={options}
                        itemToStringLabel={(option) =>
                          isLoadMore(option) ? "Load more" : option.number
                        }
                        isItemEqualToValue={(option, value) =>
                          !isLoadMore(option) && !isLoadMore(value) && option.id === value.id
                        }
                        onValueChange={(option, details) => {
                          if (option && pick(option) === false) details.cancel();
                        }}
                        autoHighlight
                        loopFocus
                        value={selected}
                        inputValue={text}
                        onInputValueChange={(next, details) => {
                          if (details.reason === "escape-key" && chosen) {
                            details.allowPropagation();

                            return;
                          }

                          if (details.reason !== "item-press") {
                            if (chosen && next !== chosen.number) setChosen(null);
                            setText(next);
                          }
                        }}
                      >
                        <ComboboxInput
                          id={creditInputId}
                          placeholder="Search number or reference"
                          autoComplete="off"
                          maxLength={100}
                          onBlur={() => setText(selected?.number ?? "")}
                        />
                        <ComboboxContent>
                          <ComboboxEmpty>
                            {credits.isPending ? (
                              <WaveLoader
                                label="Loading credits"
                                className="justify-center px-3 py-4"
                              />
                            ) : (
                              <p className="px-3 py-4 text-center">{emptyText}</p>
                            )}
                          </ComboboxEmpty>
                          <ComboboxList>
                            {(option: Credit | LoadMoreRow) => (
                              <ComboboxItem
                                key={isLoadMore(option) ? "__load-more" : option.id}
                                value={option}
                              >
                                {isLoadMore(option) ? (
                                  <span className="w-full text-center text-muted-foreground">
                                    {credits.isFetchingNextPage ? (
                                      <WaveLoader
                                        label="Loading more credits"
                                        className="justify-center"
                                      />
                                    ) : credits.isFetchNextPageError ? (
                                      "Could not load more. Try again"
                                    ) : (
                                      `${rows.length} shown · Load more`
                                    )}
                                  </span>
                                ) : (
                                  <>
                                    <CheckIcon className="invisible size-3.5 shrink-0 group-data-[selected]/combobox-item:visible" />
                                    <span className="min-w-0 truncate">
                                      <span className="text-muted-foreground">
                                        {creditLabel(option.type)} ·{" "}
                                      </span>
                                      <span className="font-mono">{option.number}</span>
                                      {option.reference ? (
                                        <span className="text-muted-foreground">
                                          {" "}
                                          · {option.reference}
                                        </span>
                                      ) : null}
                                      <span className="text-muted-foreground tabular-nums">
                                        {" "}
                                        · {formatBusinessDay(option.documentDate)}
                                      </span>
                                    </span>
                                    <span className="ml-auto shrink-0 tabular-nums">
                                      {formatMoney(option.unappliedPaise)}
                                    </span>
                                  </>
                                )}
                              </ComboboxItem>
                            )}
                          </ComboboxList>
                        </ComboboxContent>
                      </Combobox>
                    </div>

                    <RegisteredFormField
                      name="amount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Amount</FormLabel>
                          <FormControl>
                            <AmountInput symbol {...field} required />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {afterPaise !== null ? (
                      <p className="text-muted-foreground tabular-nums">
                        Outstanding after: {formatMoney(afterPaise)}
                      </p>
                    ) : null}
                  </div>
                )}

                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={onClose}>
                    Cancel
                  </Button>
                  <SubmitButton isSubmitting={apply.isPending} disabled={!selected}>
                    Apply credit
                  </SubmitButton>
                </DialogFooter>
              </fieldset>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </ClientOnly>
  );
}
