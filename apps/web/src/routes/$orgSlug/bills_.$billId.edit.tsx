import { useSuspenseQuery } from "@tanstack/react-query";
import { Navigate, createFileRoute, useNavigate } from "@tanstack/react-router";

import { BillForm } from "@/components/bill-form";
import { PageHeader } from "@/components/page";
import { billDetailOptions } from "@/lib/bills";
import { loadRouteQuery } from "@/lib/orpc-error";
import { useOrgDateTime } from "@/lib/org-datetime";
import { requireOrgPermission } from "@/lib/route-permission";
import { settingsOptions } from "@/lib/settings";

export const Route = createFileRoute("/$orgSlug/bills_/$billId/edit")({
  head: () => ({ meta: [{ title: "Edit bill draft · Accly Books" }] }),
  remountDeps: ({ params }) => ({ billId: params.billId }),
  loader: async ({ context: { queryClient }, params: { orgSlug, billId } }) => {
    await requireOrgPermission(queryClient, orgSlug, { bill: ["create"] });
    await Promise.all([
      loadRouteQuery(queryClient.query(billDetailOptions(orgSlug, billId))),
      queryClient.query(settingsOptions(orgSlug)),
    ]);
  },
  component: EditBillRoute,
});

function EditBillRoute() {
  const { orgSlug, billId } = Route.useParams();
  const { today } = useOrgDateTime();
  const navigate = useNavigate({ from: Route.fullPath });
  const bill = useSuspenseQuery(billDetailOptions(orgSlug, billId)).data;

  const toRecord = () =>
    void navigate({ to: "/$orgSlug/bills/$billId", params: { orgSlug, billId } });

  if (bill.state !== "draft")
    return <Navigate to="/$orgSlug/bills/$billId" params={{ orgSlug, billId }} replace />;

  return (
    <>
      <PageHeader title="Edit bill draft" />
      <BillForm
        orgSlug={orgSlug}
        today={today}
        draft={bill}
        onClose={toRecord}
        onPosted={toRecord}
      />
    </>
  );
}
