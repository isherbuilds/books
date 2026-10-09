import { enteredPaise, formatMoney, ZERO_MONEY } from "@accly/api/core/money";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { ALLOCATION_REFUSALS } from "@/components/allocation-table";
import { DocumentForm, PostBar } from "@/components/document-form";
import {
  blankEntryLine,
  EntryLines,
  entryLinesInput,
  entryLinesSchema,
  journalAllocationLimit,
} from "@/components/entry-lines";
import { PartySheet } from "@/components/party-form";
import { useZodForm } from "@/hooks/use-zod-form";
import { invalidateJournalState, invalidateSettlementState } from "@/lib/domain-invalidation";
import { journalAccountOptions } from "@/lib/journals";
import { useCan } from "@/lib/membership";
import { useOrgDateTime } from "@/lib/org-datetime";
import { partyPickerOptions } from "@/lib/parties";
import { orpc } from "@/lib/orpc";
import {
  applyOrpcFieldError,
  errorReason,
  handleWriteError,
  type ServerFields,
} from "@/lib/orpc-error";
import { openItemsOptions } from "@/lib/pickers";

const journalSchema = z.object({
  documentDate: z.iso.date(),
  narration: z.string().trim().min(1, "Enter a narration").max(500),
  reference: z.string().trim().max(120, "Reference must be 120 characters or fewer"),
  lines: entryLinesSchema,
});

type JournalFormValues = z.input<typeof journalSchema>;

const SERVER_FIELDS = {
  ACCOUNT_INVALID: "lines",
  TAXABLE_ACCOUNT_LINE: "lines",
  PARTY_INVALID: "lines",
  PARTY_REQUIRED: "lines",
  ALLOCATION_TARGET_INVALID: "lines",
  ALLOCATION_EXCEEDS_OUTSTANDING: "lines",
  ALLOCATION_EXCEEDS_SOURCE: "lines",
  LOCKED: "documentDate",
} satisfies ServerFields<JournalFormValues>;

function defaults(documentDate: string): JournalFormValues {
  return {
    documentDate,
    narration: "",
    reference: "",
    lines: [blankEntryLine(), blankEntryLine()],
  };
}

export function JournalForm({ orgSlug, onClose }: { orgSlug: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { today } = useOrgDateTime();

  const form = useZodForm(journalSchema, { defaultValues: defaults(today) });

  const accounts = useQuery(journalAccountOptions(orgSlug));
  const parties = useQuery(partyPickerOptions(orgSlug));
  const canCreateParty = useCan(orgSlug, { party: ["create"] });
  const [createParty, setCreateParty] = useState<{ index: number; seed: string } | null>(null);

  // Only the remount after a post jumps into the first line; initial navigation keeps
  // the router's focus flow intact. `reset` keeps the count, so the remount can tell.
  const entered = form.formState.submitCount > 0;

  const post = useMutation(
    orpc.journal.post.mutationOptions({
      onSuccess: async ({ number }) => {
        await invalidateJournalState(queryClient, orgSlug);
        toast.success(`Journal ${number} posted`);
        form.reset(defaults(form.getValues("documentDate")), { keepSubmitCount: true });
      },
      onError: (error) =>
        handleWriteError(error, {
          settle: () => {
            onClose();

            return invalidateJournalState(queryClient, orgSlug);
          },
          fallback: "Could not post the journal",
          uncertain: "The result is uncertain. Check the journal list before entering it again.",
          refuse: async () => {
            applyOrpcFieldError(form, error, SERVER_FIELDS, "Could not post the journal");

            if (ALLOCATION_REFUSALS.has(errorReason(error)))
              await invalidateSettlementState(queryClient, orgSlug);
          },
        }),
    }),
  );

  const submit = form.handleSubmit((values) => {
    if (!accounts.data) {
      form.setError("lines", { message: "Wait for the accounts to load" });

      return;
    }

    const accountById = new Map(accounts.data.map((account) => [account.id, account]));

    for (const [index, line] of values.lines.entries()) {
      if (accountById.get(line.accountId)?.systemKey !== "receivables") continue;

      if (!line.partyId) {
        form.setError(
          `lines.${index}.partyId`,
          { message: "Choose a party" },
          { shouldFocus: true },
        );

        return;
      }

      // The resolver skips field rules, so the table's limit is checked here. An
      // invoice missing from the cache is left to the server.
      const open = queryClient.getQueryData(
        openItemsOptions({ orgSlug, partyId: line.partyId, side: "receivable", type: "invoice" })
          .queryKey,
      );

      for (const row of open?.pages.flatMap((page) => page.rows) ?? []) {
        const amount = line.allocations[row.id];
        const limit = journalAllocationLimit(values.lines, index, row.id, row.outstandingPaise);

        if (amount && enteredPaise(amount) > limit) {
          form.setError(
            `lines.${index}.allocations.${row.id}`,
            {
              message: `Enter no more than ${formatMoney(limit > ZERO_MONEY ? limit : ZERO_MONEY)}`,
            },
            { shouldFocus: true },
          );

          return;
        }
      }
    }

    post.mutate({
      orgSlug,
      documentDate: values.documentDate,
      narration: values.narration,
      reference: values.reference || undefined,
      lines: entryLinesInput(values.lines).map((line, index) => {
        const allocations = Object.entries(values.lines[index]?.allocations ?? {})
          .filter(([, amount]) => amount !== "")
          .map(([invoiceId, amount]) => ({ invoiceId, amount }));

        return allocations.length ? { ...line, allocations } : line;
      }),
    });
  });

  return (
    <Form {...form}>
      <DocumentForm
        // Each post remounts the fields, so the next entry starts on the first field.
        key={post.data?.id}
        pending={post.isPending}
        onSubmit={(event) => void submit(event)}
        footer={
          <PostBar
            onClose={onClose}
            closeLabel="Back to journals"
            post={post}
            postLabel="Post journal"
          />
        }
      >
        <div className="grid gap-3 md:grid-cols-[12rem_16rem]">
          <RegisteredFormField
            name="documentDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Journal date</FormLabel>
                <FormControl>
                  <Input {...field} required type="date" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <RegisteredFormField
            name="reference"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Reference (optional)</FormLabel>
                <FormControl>
                  <Input {...field} maxLength={120} autoComplete="off" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <RegisteredFormField
            name="narration"
            render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>Narration</FormLabel>
                <FormControl>
                  <Textarea {...field} required maxLength={500} rows={2} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <EntryLines
          orgSlug={orgSlug}
          title="Lines"
          accounts={accounts}
          parties={parties}
          onCreateParty={
            canCreateParty ? (index, seed) => setCreateParty({ index, seed }) : undefined
          }
          autoFocusFirst={entered}
        />
      </DocumentForm>
      <PartySheet
        orgSlug={orgSlug}
        open={createParty !== null}
        seedName={createParty?.seed ?? ""}
        // Base UI returns focus to the Party field that opened the Sheet.
        onClose={() => setCreateParty(null)}
        onSaved={(party) => {
          if (!createParty) return;

          const { index } = createParty;
          form.setValue(`lines.${index}.partyId`, party.id, {
            shouldDirty: true,
            shouldValidate: true,
          });
          form.setValue(`lines.${index}.partyName`, party.name, { shouldDirty: true });
          setCreateParty(null);
        }}
      />
    </Form>
  );
}
