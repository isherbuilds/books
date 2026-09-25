import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { BillForm } from "@/components/bill-form";
import { PageHeader } from "@/components/page";
import { useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { requireOrgPermission } from "@/lib/route-permission";

export const Route = createFileRoute("/$orgSlug/bills_/new")({
  head: () => ({ meta: [{ title: "New bill · Accly Books" }] }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { bill: ["create"] });
    await queryClient.query(orpc.settings.get.queryOptions({ input: { orgSlug } }));
  },
  component: NewBillRoute,
});

function NewBillRoute() {
  const { orgSlug } = Route.useParams();
  const { today } = useOrgDateTime();
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <>
      <PageHeader title="New bill" />
      <BillForm
        orgSlug={orgSlug}
        today={today}
        onClose={() => void navigate({ to: "/$orgSlug/bills", params: { orgSlug } })}
        onSaved={(billId) =>
          void navigate({
            to: "/$orgSlug/bills/$billId/edit",
            params: { orgSlug, billId },
            replace: true,
          })
        }
        onPosted={(billId) =>
          void navigate({ to: "/$orgSlug/bills/$billId", params: { orgSlug, billId } })
        }
      />
    </>
  );
}
