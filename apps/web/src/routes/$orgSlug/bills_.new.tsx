import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { BillForm } from "@/components/bill-form";
import { PageHeader } from "@/components/page";
import { useOrgDateTime } from "@/lib/org-datetime";
import { requireOrgPermission } from "@/lib/route-permission";

export const Route = createFileRoute("/$orgSlug/bills_/new")({
  head: () => ({ meta: [{ title: "New bill · Accly Books" }] }),
  loader: ({ context: { queryClient }, params: { orgSlug } }) =>
    requireOrgPermission(queryClient, orgSlug, { bill: ["create"] }),
  component: NewBillRoute,
});

function NewBillRoute() {
  const { orgSlug } = Route.useParams();
  const { today } = useOrgDateTime();
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <>
      <PageHeader title="New bill" description="Create a draft or post this supplier bill." />
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
