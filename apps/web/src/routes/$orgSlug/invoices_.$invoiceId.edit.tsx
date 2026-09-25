import { useSuspenseQuery } from "@tanstack/react-query";
import { Navigate, createFileRoute, useNavigate } from "@tanstack/react-router";

import { InvoiceForm } from "@/components/invoice-form";
import { PageHeader } from "@/components/page";
import { invoiceDetailOptions } from "@/lib/invoices";
import { loadRouteQuery } from "@/lib/orpc-error";
import { useOrgDateTime } from "@/lib/org-datetime";
import { requireOrgPermission } from "@/lib/route-permission";

// Design §10: a line grid is a Page. Only a draft is editable.
export const Route = createFileRoute("/$orgSlug/invoices_/$invoiceId/edit")({
  head: () => ({ meta: [{ title: "Edit draft · Accly Books" }] }),
  remountDeps: ({ params }) => ({ invoiceId: params.invoiceId }),
  loader: async ({ context: { queryClient }, params: { orgSlug, invoiceId } }) => {
    await requireOrgPermission(queryClient, orgSlug, { invoice: ["create"] });
    await loadRouteQuery(queryClient.query(invoiceDetailOptions(orgSlug, invoiceId)));
  },
  component: EditInvoiceRoute,
});

function EditInvoiceRoute() {
  const { orgSlug, invoiceId } = Route.useParams();
  const { today } = useOrgDateTime();
  const navigate = useNavigate({ from: Route.fullPath });
  const invoice = useSuspenseQuery(invoiceDetailOptions(orgSlug, invoiceId)).data;

  const toRecord = () =>
    void navigate({ to: "/$orgSlug/invoices/$invoiceId", params: { orgSlug, invoiceId } });

  // Posted or cancelled elsewhere: the record is the only view left.
  if (invoice.state !== "draft") {
    return <Navigate to="/$orgSlug/invoices/$invoiceId" params={{ orgSlug, invoiceId }} replace />;
  }

  return (
    <>
      <PageHeader title="Edit draft" />
      <InvoiceForm
        orgSlug={orgSlug}
        today={today}
        draft={invoice}
        onClose={toRecord}
        onPosted={toRecord}
      />
    </>
  );
}
