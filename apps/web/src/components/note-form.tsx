import {
  enteredPaise,
  formatDecimal,
  formatMoney,
  isPositiveMoney,
  ZERO_MONEY,
} from "@accly/api/core/money";
import { formatBusinessDate } from "@accly/api/lib/business-date";
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
import { Kbd } from "@accly/ui/components/kbd";
import { Textarea } from "@accly/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { DocumentForm, FieldArrayError, LineGrid, PostBar } from "@/components/document-form";
import { NoteSourceLink } from "@/components/note-columns";
import { useZodForm } from "@/hooks/use-zod-form";
import { invalidateSettlementState } from "@/lib/domain-invalidation";
import { NOTE_TYPE_LABELS, type NoteSource } from "@/lib/notes";
import { useCan } from "@/lib/membership";
import { orpc } from "@/lib/orpc";
import { applyOrpcFieldError, handleWriteError } from "@/lib/orpc-error";

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
      amounts: z.array(z.object({ amount: z.string() })).length(source.lines.length),
    })
    .superRefine((values, context) => {
      let selected = false;
      values.amounts.forEach(({ amount }, index) => {
        if (!amount) return;
        const paise = enteredPaise(amount);

        if (!isPositiveMoney(paise) || paise > source.lines[index]!.amountPaise) {
          context.addIssue({
            code: "custom",
            path: ["amounts", index, "amount"],
            message: "Enter an amount within this line's taxable value",
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
      narration: "",
      amounts: source.lines.map(() => ({ amount: "" })),
    },
  });

  const amounts = useWatch({ control: form.control, name: "amounts" });
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
    const lines = values.amounts.flatMap(({ amount }, index) =>
      amount && isPositiveMoney(enteredPaise(amount))
        ? [{ sourceLineId: source.lines[index]!.id, amount }]
        : [],
    );

    if (lines.length === 0) return;
    post.mutate({
      orgSlug,
      type,
      againstDocumentId: source.id,
      documentDate: values.documentDate,
      narration: values.narration,
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
          <PostBar onClose={onClose} closeLabel="Close">
            {canPost ? (
              <Button type="submit">
                {post.isPending ? "Posting…" : "Post note"}
                <Kbd>⌘↵</Kbd>
              </Button>
            ) : null}
          </PostBar>
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
        <LineGrid title="Source lines">
          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_repeat(3,minmax(0,0.8fr))_minmax(0,1fr)] gap-2 border-b border-border pb-2 text-muted-foreground md:grid">
            <span>Description</span>
            <span>HSN/SAC</span>
            <span className="text-right">Taxable</span>
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
                <span className="text-muted-foreground md:hidden">Taxable </span>
                {formatMoney(line.amountPaise)}
              </span>
              <span className="tabular-nums md:text-right">
                <span className="text-muted-foreground md:hidden">Rate </span>
                {line.rateBasisPoints === null ? "—" : `${line.rateBasisPoints / 100}%`}
              </span>
              <span className="tabular-nums md:text-right">
                <span className="text-muted-foreground md:hidden">Tax </span>
                {formatMoney(line.cgstPaise + line.sgstPaise + line.igstPaise)}
              </span>
              <RegisteredFormField
                name={`amounts.${index}.amount`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="md:sr-only">Note amount for {line.description}</FormLabel>
                    <div className="flex gap-1">
                      <FormControl>
                        <Input
                          {...field}
                          inputMode="decimal"
                          placeholder="0.00"
                          aria-label={`Note amount for ${line.description}`}
                        />
                      </FormControl>
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        onClick={() =>
                          form.setValue(
                            `amounts.${index}.amount`,
                            formatDecimal(line.amountPaise),
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
        <p className="text-muted-foreground">
          Tax and round-off are calculated on posting. Selected taxable:{" "}
          <span className="tabular-nums text-foreground">
            {formatMoney(
              amounts?.reduce((sum, row) => sum + enteredPaise(row.amount), ZERO_MONEY) ??
                ZERO_MONEY,
            )}
          </span>
        </p>
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
