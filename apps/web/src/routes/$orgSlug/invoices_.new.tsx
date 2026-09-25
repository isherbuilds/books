import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { InvoiceForm } from "@/components/invoice-form";
import { PageHeader } from "@/components/page";
import { requireOrgPermission } from "@/lib/route-permission";
import { useOrgDateTime } from "@/lib/org-datetime";

// Design §10: a line grid is a Page.
export const Route = createFileRoute("/$orgSlug/invoices_/new")({
  head: () => ({ meta: [{ title: "New invoice · Accly Books" }] }),
  loader: ({ context: { queryClient }, params: { orgSlug } }) =>
    requireOrgPermission(queryClient, orgSlug, { invoice: ["create"] }),
  component: NewInvoiceRoute,
});

function NewInvoiceRoute() {
  const { orgSlug } = Route.useParams();
  const { today } = useOrgDateTime();
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <>
      <PageHeader title="New invoice" />
      <InvoiceForm
        orgSlug={orgSlug}
        today={today}
        onClose={() => void navigate({ to: "/$orgSlug/invoices", params: { orgSlug } })}
        // The saved draft continues in its own editor, so a reload keeps it.
        onSaved={(invoiceId) =>
          void navigate({
            to: "/$orgSlug/invoices/$invoiceId/edit",
            params: { orgSlug, invoiceId },
            replace: true,
          })
        }
        onPosted={(invoiceId) =>
          void navigate({ to: "/$orgSlug/invoices/$invoiceId", params: { orgSlug, invoiceId } })
        }
      />
    </>
  );
}
