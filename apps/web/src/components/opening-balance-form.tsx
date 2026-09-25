import { Button } from "@accly/ui/components/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@accly/ui/components/form";
import { Input } from "@accly/ui/components/input";
import { Kbd } from "@accly/ui/components/kbd";
import { SheetFooter } from "@accly/ui/components/sheet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FieldPath } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { DocumentForm } from "@/components/document-form";
import {
  blankEntryLine,
  EntryLines,
  entryLinesInput,
  entryLinesSchema,
} from "@/components/entry-lines";
import { useZodForm } from "@/hooks/use-zod-form";
import { invalidateOpeningBalanceState } from "@/lib/domain-invalidation";
import { journalAccountOptions } from "@/lib/journals";
import { orpc } from "@/lib/orpc";
import { applyOrpcFieldError, handleWriteError } from "@/lib/orpc-error";
import { useOrgDateTime } from "@/lib/org-datetime";

const openingBalanceSchema = z.object({
  documentDate: z.iso.date(),
  lines: entryLinesSchema,
});

type OpeningBalanceFormValues = z.input<typeof openingBalanceSchema>;

const SERVER_FIELDS = {
  ACCOUNT_INVALID: "lines",
  TAXABLE_ACCOUNT_LINE: "lines",
  LOCKED: "documentDate",
} satisfies Record<string, FieldPath<OpeningBalanceFormValues>>;

export function OpeningBalanceForm({ orgSlug }: { orgSlug: string }) {
  const queryClient = useQueryClient();
  const { today } = useOrgDateTime();

  const form = useZodForm(openingBalanceSchema, {
    defaultValues: { documentDate: today, lines: [blankEntryLine(), blankEntryLine()] },
  });

  const accounts = useQuery(journalAccountOptions(orgSlug));

  const post = useMutation(
    orpc.openingBalance.post.mutationOptions({
      onSuccess: async () => {
        await invalidateOpeningBalanceState(queryClient, orgSlug);
        toast.success("Opening balance posted");
      },
      // A lost response may have posted it; a CONFLICT means one is already posted.
      onError: (error) =>
        handleWriteError(error, {
          settle: () => invalidateOpeningBalanceState(queryClient, orgSlug),
          fallback: "Could not post the opening balance",
          uncertain: "The result is uncertain. Reload the page before entering it again.",
          refuse: () =>
            applyOrpcFieldError(form, error, SERVER_FIELDS, "Could not post the opening balance"),
        }),
    }),
  );

  const submit = form.handleSubmit((values) => {
    post.mutate({
      orgSlug,
      documentDate: values.documentDate,
      lines: entryLinesInput(values.lines),
    });
  });

  return (
    <Form {...form}>
      <DocumentForm
        pending={post.isPending}
        onSubmit={(event) => void submit(event)}
        footer={
          <SheetFooter>
            <Button type="submit">
              {post.isPending ? "Posting…" : post.isError ? "Post again" : "Post opening balance"}
              <Kbd>⌘↵</Kbd>
            </Button>
          </SheetFooter>
        }
      >
        <div className="grid gap-3 md:max-w-md">
          <RegisteredFormField
            name="documentDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>As at</FormLabel>
                <FormControl>
                  <Input {...field} required type="date" />
                </FormControl>
                <FormDescription>
                  The day before your first entry here. Party balances (receivables, payables and
                  advances) cannot go on this document, and Accly Books cannot record them yet.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <EntryLines title="Balances" accounts={accounts} autoFocusFirst={false} />
      </DocumentForm>
    </Form>
  );
}
