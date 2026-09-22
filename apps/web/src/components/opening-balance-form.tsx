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
import { SheetFooter } from "@accly/ui/components/sheet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FieldPath } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { DocumentForm } from "@/components/document-form";
import { blankEntryLine, EntryLines, entryLinesSchema } from "@/components/entry-lines";
import { useZodForm } from "@/hooks/use-zod-form";
import { invalidateOpeningBalanceState } from "@/lib/domain-invalidation";
import { journalAccountOptions } from "@/lib/journals";
import { orpc } from "@/lib/orpc";
import { applyOrpcFieldError, errorMessage, hasErrorCode, isRefusal } from "@/lib/orpc-error";

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

function defaults(documentDate: string): OpeningBalanceFormValues {
  return {
    documentDate,
    lines: [blankEntryLine("debit"), blankEntryLine("credit")],
  };
}

export function OpeningBalanceForm({
  orgSlug,
  today,
  onPosted,
}: {
  orgSlug: string;
  today: string;
  onPosted: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useZodForm(openingBalanceSchema, { defaultValues: defaults(today) });
  const accounts = useQuery(journalAccountOptions(orgSlug));

  const post = useMutation(
    orpc.openingBalance.post.mutationOptions({
      onSuccess: async () => {
        await invalidateOpeningBalanceState(queryClient, orgSlug);
        onPosted();
      },
      onError: async (error) => {
        if (!isRefusal(error)) {
          await invalidateOpeningBalanceState(queryClient, orgSlug);
          toast.error("The result is uncertain. Reload the page before entering it again.");

          return;
        }

        if (hasErrorCode(error, "CONFLICT")) {
          await invalidateOpeningBalanceState(queryClient, orgSlug);
          toast.error(errorMessage(error, "An opening balance is already posted."));

          return;
        }

        applyOrpcFieldError(form, error, SERVER_FIELDS, "Could not post the opening balance");
      },
    }),
  );

  const submit = form.handleSubmit((values) => {
    post.mutate({
      orgSlug,
      documentDate: values.documentDate,
      lines: values.lines.map(({ accountId, side, amount, description }) => ({
        accountId,
        side,
        amount,
        description: description || undefined,
      })),
    });
  });

  return (
    <div className="max-w-2xl">
      <Form {...form}>
        <DocumentForm
          pending={post.isPending}
          onSubmit={(event) => void submit(event)}
          footer={
            <SheetFooter>
              <Button type="submit">
                {post.isPending ? "Posting…" : post.isError ? "Post again" : "Post opening balance"}
                <span className="text-[0.625rem] opacity-70">⌘↵</span>
              </Button>
            </SheetFooter>
          }
        >
          <RegisteredFormField
            name="documentDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>As at</FormLabel>
                <FormControl>
                  <Input {...field} required type="date" />
                </FormControl>
                <FormDescription>
                  The day before your first entry here. Party balances come from the import, never
                  from this document.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <EntryLines title="Balances" accounts={accounts} autoFocusFirst={false} />
        </DocumentForm>
      </Form>
    </div>
  );
}
