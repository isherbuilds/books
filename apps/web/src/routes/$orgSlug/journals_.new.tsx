import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { JournalForm } from "@/components/journal-form";
import { PageHeader } from "@/components/page";
import { journalAccountOptions } from "@/lib/journals";
import { partyPickerOptions } from "@/lib/parties";
import { requireOrgPermission } from "@/lib/route-permission";

export const Route = createFileRoute("/$orgSlug/journals_/new")({
  head: () => ({ meta: [{ title: "New journal · Accly Books" }] }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { journal: ["post"] });
    await Promise.all([
      queryClient.query(journalAccountOptions(orgSlug)).catch(() => {}),
      queryClient.query(partyPickerOptions(orgSlug)).catch(() => {}),
    ]);
  },
  component: NewJournalRoute,
});

function NewJournalRoute() {
  const { orgSlug } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <>
      <PageHeader
        title="New journal"
        description="Move balances between accounts with a balanced voucher"
      />
      <JournalForm
        orgSlug={orgSlug}
        onClose={() => void navigate({ to: "/$orgSlug/journals", params: { orgSlug } })}
      />
    </>
  );
}
