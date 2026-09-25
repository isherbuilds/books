import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { NoteForm } from "@/components/note-form";
import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { billDetailOptions } from "@/lib/bills";
import { invoiceDetailOptions } from "@/lib/invoices";
import { NOTE_TYPE_LABELS, type NoteSource } from "@/lib/notes";
import { useOrgDateTime } from "@/lib/org-datetime";
import { loadRouteQuery } from "@/lib/orpc-error";
import { requireOrgPermission } from "@/lib/route-permission";

const noteSearch = z.object({
  type: z.enum(["creditNote", "debitNote"]),
  against: z.uuid(),
});

export const Route = createFileRoute("/$orgSlug/notes_/new")({
  head: () => ({ meta: [{ title: "New note · Accly Books" }] }),
  validateSearch: noteSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ context: { queryClient }, params: { orgSlug }, deps: { type, against } }) => {
    await requireOrgPermission(queryClient, orgSlug, { note: ["post"] });

    if (type === "creditNote") {
      await loadRouteQuery(queryClient.query(invoiceDetailOptions(orgSlug, against)));
    } else {
      await loadRouteQuery(queryClient.query(billDetailOptions(orgSlug, against)));
    }
  },
  component: NewNoteRoute,
});

function NewNoteRoute() {
  const { orgSlug } = Route.useParams();
  const { type, against } = Route.useSearch();
  const { today } = useOrgDateTime();
  const navigate = useNavigate({ from: Route.fullPath });

  // The loader primed exactly this one source.
  const source = useSuspenseQuery<NoteSource>(
    type === "creditNote"
      ? invoiceDetailOptions(orgSlug, against)
      : billDetailOptions(orgSlug, against),
  ).data;

  const close = () => void navigate({ to: "/$orgSlug/notes", params: { orgSlug } });

  return (
    <>
      <PageHeader
        title={`New ${NOTE_TYPE_LABELS[type].toLowerCase()}`}
        description={`Reduce a posted ${type === "creditNote" ? "invoice" : "bill"}.`}
      />
      <PageBody>
        {source.state === "posted" ? (
          <NoteForm
            orgSlug={orgSlug}
            type={type}
            source={source}
            today={today}
            onClose={close}
            onPosted={(noteId) =>
              void navigate({
                to: "/$orgSlug/notes/$noteId",
                params: { orgSlug, noteId },
                replace: true,
              })
            }
          />
        ) : (
          <ErrorNote
            title="Source is not posted"
            detail="Only a posted source document can have a note."
          />
        )}
      </PageBody>
    </>
  );
}
