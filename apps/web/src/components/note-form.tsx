import {
  enteredPaise,
  formatDecimal,
  formatMoney,
  isPositiveMoney,
  ZERO_MONEY,
} from "@accly/api/core/money";
import { formatBusinessDate } from "@accly/api/lib/business-date";
import { NOTE_TYPE_LABELS } from "@accly/api/lib/document-labels";
import { reason } from "@accly/api/lib/schemas";
import { Button } from "@accly/ui/components/button";
import {
  Form,
  FormControl,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@accly/ui/components/form";
import { Input } from "@accly/ui/components/input";
import { Textarea } from "@accly/ui/components/textarea";
import { cn } from "@accly/ui/lib/utils";
import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { AmountInput } from "@/components/amount-input";
import { DocumentForm, FieldArrayError, LineGrid, PostBar } from "@/components/document-form";
import { DocumentTotals } from "@/components/invoice-summary";
import { NoteSourceLink } from "@/components/note-columns";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useZodForm } from "@/hooks/use-zod-form";
import { invalidateSettlementState } from "@/lib/domain-invalidation";
import type { NoteSource } from "@/lib/notes";
import { useCan } from "@/lib/membership";
import { orpc } from "@/lib/orpc";
import { applyOrpcFieldError, errorMessage, handleWriteError } from "@/lib/orpc-error";

type NoteLines = { sourceLineId: string; amount: string }[];

/** The lines with a positive amount typed, as the quote and the post take them. */
const noteLines = (source: NoteSource, amounts: readonly { amount: string }[]): NoteLines =>
  source.lines.flatMap((line, index) => {
    const amount = amounts[index]?.amount ?? "";

    return isPositiveMoney(enteredPaise(amount)) ? [{ sourceLineId: line.id, amount }] : [];
  });

export function NoteForm({
  orgSlug,
  type,
  source,
  today,
  onClose,
  onPosted,
}: {
  orgSlug: string;
  type: "creditNote" | "debitNote";
  source: NoteSource;
  today: string;
  onClose: () => void;
  onPosted: (noteId: string) => void;
}) {
  const queryClient = useQueryClient();
  const canPost = useCan(orgSlug, { note: ["post"] });

  const schema = z
    .object({
      documentDate: z.iso
        .date()
        .refine((date) => date >= source.documentDate, "Date must be on or after the source date"),
      narration: reason,
      reference: z
        .string()
        .trim()
        .max(40, "Supplier credit note number must be 40 characters or fewer"),
      amounts: z.array(z.object({ amount: z.string() })).length(source.lines.length),
    })
    .superRefine((values, context) => {
      let selected = false;
      source.lines.forEach((line, index) => {
        const amount = values.amounts[index]?.amount;

        if (!amount) return;
        const paise = enteredPaise(amount);

        if (!isPositiveMoney(paise) || paise > line.remainingPaise) {
          context.addIssue({
            code: "custom",
            path: ["amounts", index, "amount"],
            message: "Enter an amount up to what is left to return on this line",
          });
        } else selected = true;
      });

      if (!selected)
        context.addIssue({
          code: "custom",
          path: ["amounts"],
          message: "Enter an amount on at least one line",
        });
    });

  const form = useZodForm(schema, {
    defaultValues: {
      documentDate: today < source.documentDate ? source.documentDate : today,
      reference: "",
      narration: "",
      amounts: source.lines.map(() => ({ amount: "" })),
    },
  });

  // Deep-compared, so a reason or date keystroke re-renders nothing here.
  const lines = useWatch({
    control: form.control,
    compute: (values: { amounts: { amount: string }[] }) => noteLines(source, values.amounts),
  });

  const request = canPost && lines.length > 0 ? lines : null;
  const debounced = useDebouncedValue(request, 300);

  const quote = useQuery({
    ...orpc.note.quote.queryOptions({
      input: debounced
        ? { orgSlug, type, againstDocumentId: source.id, lines: debounced }
        : skipToken,
    }),
    placeholderData: keepPreviousData,
    retry: false,
  });

  // With nothing to quote the last quote no longer applies; one for other amounts shows dimmed.
  const quoted = request && debounced ? quote.data : undefined;
  const stale = quote.isPlaceholderData || quote.isFetching || request !== debounced;

  const invalidate = () => invalidateSettlementState(queryClient, orgSlug);

  const post = useMutation(
    orpc.note.post.mutationOptions({
      onSuccess: async ({ id }) => {
        await invalidate();
        toast.success(`${NOTE_TYPE_LABELS[type]} posted`);
        onPosted(id);
      },
      onError: (error) =>
        handleWriteError(error, {
          settle: () => {
            onClose();

            return invalidate();
          },
          fallback: `Could not post the ${NOTE_TYPE_LABELS[type].toLowerCase()}`,
          uncertain: "The result is uncertain. Check the notes list before trying again.",
          // The server names the line that no longer fits, after earlier notes.
          refuse: () =>
            applyOrpcFieldError(
              form,
              error,
              { NOTE_DATE_BEFORE_SOURCE: "documentDate", NOTE_EXCEEDS_SOURCE: "amounts" },
              "Could not post the note",
            ),
        }),
    }),
  );

  const submit = form.handleSubmit((values) => {
    const lines = noteLines(source, values.amounts);

    if (lines.length === 0) return;

    // The server keeps a reference only on a debit note: the supplier's credit note number.
    post.mutate({
      orgSlug,
      type,
      againstDocumentId: source.id,
      documentDate: values.documentDate,
      narration: values.narration,
      reference: values.reference,
      lines,
    });
  });

  return (
    <Form {...form}>
      <DocumentForm
        pending={post.isPending}
        onSubmit={(event) => {
          if (canPost) void submit(event);
        }}
        footer={
          <PostBar onClose={onClose} post={canPost ? post : undefined} postLabel="Post note" />
        }
      >
        <p className="text-muted-foreground">
          {NOTE_TYPE_LABELS[type]} against {type === "creditNote" ? "invoice" : "bill"}{" "}
          <NoteSourceLink
            orgSlug={orgSlug}
            noteType={type}
            source={source}
            className="text-foreground"
          />
          {" · "}
          {source.partyName ?? "No party"}
          {" · "}
          {formatBusinessDate(source.documentDate)}
        </p>
        <RegisteredFormField
          name="documentDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Note date</FormLabel>
              <FormControl>
                <Input {...field} type="date" min={source.documentDate} required />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {type === "debitNote" ? (
          <RegisteredFormField
            name="reference"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Supplier credit note number (optional)</FormLabel>
                <FormControl>
                  <Input {...field} maxLength={40} autoComplete="off" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}
        <LineGrid title="Source lines">
          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_repeat(3,minmax(0,0.8fr))_minmax(0,1fr)] gap-2 border-b border-border pb-2 text-muted-foreground md:grid">
            <span>Description</span>
            <span>HSN/SAC</span>
            <span className="text-right">Left to return</span>
            <span className="text-right">Rate</span>
            <span className="text-right">Tax</span>
            <span className="text-right">Amount</span>
          </div>
          {source.lines.map((line, index) => (
            <div
              key={line.id}
              className="grid gap-2 border-b border-border pb-3 last:border-b-0 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_repeat(3,minmax(0,0.8fr))_minmax(0,1fr)] md:items-start"
            >
              <span className="break-words">{line.description}</span>
              <span className="font-mono text-muted-foreground">{line.hsnSac ?? "—"}</span>
              <span className="tabular-nums md:text-right">
                <span className="text-muted-foreground md:hidden">Left to return </span>
                {formatMoney(line.remainingPaise)}
              </span>
              <span className="tabular-nums md:text-right">
                <span className="text-muted-foreground md:hidden">Rate </span>
                {line.rateBasisPoints === null ? "—" : `${line.rateBasisPoints / 100}%`}
              </span>
              <span className="tabular-nums md:text-right">
                <span className="text-muted-foreground md:hidden">Tax </span>
                {formatMoney(line.taxPaise)}
              </span>
              <RegisteredFormField
                name={`amounts.${index}.amount`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="md:sr-only">Note amount for {line.description}</FormLabel>
                    <div className="flex gap-1">
                      <FormControl>
                        <AmountInput {...field} />
                      </FormControl>
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={!isPositiveMoney(line.remainingPaise)}
                        onClick={() =>
                          form.setValue(
                            `amounts.${index}.amount`,
                            formatDecimal(line.remainingPaise),
                            { shouldDirty: true, shouldValidate: true },
                          )
                        }
                      >
                        Full
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          ))}
          <FieldArrayError control={form.control} name="amounts" />
        </LineGrid>
        {quoted ? (
          <section aria-label="Note totals" className={cn("grid gap-2", stale && "opacity-60")}>
            <DocumentTotals document={{ ...quoted, totals: quoted, discountPaise: ZERO_MONEY }} />
            {isPositiveMoney(quoted.tdsPaise) ? (
              <p className="text-muted-foreground">
                Lowers what you owe this supplier by{" "}
                <span className="tabular-nums text-foreground">{formatMoney(quoted.netPaise)}</span>
                : the note&apos;s {formatMoney(quoted.totalPaise)} less{" "}
                {formatMoney(quoted.tdsPaise)} TDS you had kept back.
              </p>
            ) : null}
          </section>
        ) : null}
        {request && quote.isError ? (
          <p role="alert" className="text-destructive">
            {errorMessage(quote.error, "Could not work out the totals")}
          </p>
        ) : null}
        <RegisteredFormField
          name="narration"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Reason</FormLabel>
              <FormControl>
                <Textarea {...field} required maxLength={500} rows={3} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </DocumentForm>
    </Form>
  );
}
