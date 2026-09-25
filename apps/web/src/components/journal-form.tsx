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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FieldPath } from "react-hook-form";
import { z } from "zod";

import { DocumentForm, PostBar, PostedView } from "@/components/document-form";
import {
  blankEntryLine,
  EntryLines,
  entryLinesInput,
  entryLinesSchema,
} from "@/components/entry-lines";
import { PartySheet } from "@/components/party-form";
import { useZodForm } from "@/hooks/use-zod-form";
import { invalidateJournalState } from "@/lib/domain-invalidation";
import { journalAccountOptions } from "@/lib/journals";
import { useCan } from "@/lib/membership";
import { useOrgDateTime } from "@/lib/org-datetime";
import { partyPickerOptions } from "@/lib/parties";
import { orpc } from "@/lib/orpc";
import { applyOrpcFieldError, handleWriteError } from "@/lib/orpc-error";

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
  LOCKED: "documentDate",
} satisfies Record<string, FieldPath<JournalFormValues>>;

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

  // Only Post and next jumps into the first line; initial navigation keeps the
  // router's focus flow intact. `reset` keeps the count, so the remount can tell.
  const entered = form.formState.submitCount > 0;

  const post = useMutation(
    orpc.journal.post.mutationOptions({
      onSuccess: () => invalidateJournalState(queryClient, orgSlug),
      onError: (error) =>
        handleWriteError(error, {
          settle: () => {
            onClose();

            return invalidateJournalState(queryClient, orgSlug);
          },
          fallback: "Could not post the journal",
          uncertain: "The result is uncertain. Check the journal list before entering it again.",
          refuse: () =>
            applyOrpcFieldError(form, error, SERVER_FIELDS, "Could not post the journal"),
        }),
    }),
  );

  const submit = form.handleSubmit((values) => {
    post.mutate({
      orgSlug,
      documentDate: values.documentDate,
      narration: values.narration,
      reference: values.reference || undefined,
      lines: entryLinesInput(values.lines),
    });
  });

  const posted = post.data;

  if (posted) {
    return (
      <PostedView
        number={posted.number}
        onDone={onClose}
        onNext={() => {
          const { documentDate } = form.getValues();
          form.reset(defaults(documentDate), { keepSubmitCount: true });
          post.reset();
        }}
      />
    );
  }

  return (
    <Form {...form}>
      <DocumentForm
        pending={post.isPending}
        onSubmit={(event) => void submit(event)}
        footer={
          <PostBar onClose={onClose} closeLabel="Back to journals">
            <Button type="submit">
              {post.isPending ? "Posting…" : post.isError ? "Post again" : "Post journal"}
              <Kbd>⌘↵</Kbd>
            </Button>
          </PostBar>
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
