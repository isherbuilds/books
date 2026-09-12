import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { OpdIntakeForm } from "@/components/opd-intake-form";
import { PageBody, PageHeader } from "@/components/page";
import { formatBusinessDate, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { loadRouteQuery } from "@/lib/orpc-error";
import { requireOrgPermission } from "@/lib/route-permission";

const intakeSearch = z.object({
  customerId: z.string().optional(),
});

// Wider than the grant its name suggests: both selects are fed from the staff
// lists, so `opd:create` alone would get a form it could never submit.
// `billing:write` stays out — the form degrades to scheduling without it.
const INTAKE_PERMISSION = {
  opd: ["create"],
  customer: ["read"],
  staff: ["read"],
} as const;

export const Route = createFileRoute("/$orgSlug/opd/new")({
  head: () => ({ meta: [{ title: "Appointment · Accly Books" }] }),
  validateSearch: intakeSearch,
  loaderDeps: ({ search: { customerId } }) => ({ customerId }),
  loader: async ({ context: { queryClient }, params: { orgSlug }, deps: { customerId } }) => {
    await requireOrgPermission(queryClient, orgSlug, INTAKE_PERMISSION, "/$orgSlug/opd");

    const [customer] = await Promise.all([
      // `?customerId` fixes the customer and the picker is not offered, so a failed read
      // must stop the page instead of falling back to a free choice.
      customerId
        ? loadRouteQuery(
            queryClient.query(orpc.customer.get.queryOptions({ input: { orgSlug, customerId } })),
          )
        : undefined,
      queryClient.query(orpc.staff.listDepartments.queryOptions({ input: { orgSlug } })),
      queryClient.query(orpc.staff.listPractitioners.queryOptions({ input: { orgSlug } })),
    ]);

    return {
      seedCustomer: customer
        ? { id: customer.id, name: customer.name, code: customer.code }
        : undefined,
    };
  },
  component: NewOpdAppointmentRoute,
});

function NewOpdAppointmentRoute() {
  const { orgSlug } = Route.useParams();
  const { seedCustomer } = Route.useLoaderData();
  const { today } = useOrgDateTime();

  const departments = useSuspenseQuery(
    orpc.staff.listDepartments.queryOptions({ input: { orgSlug } }),
  ).data;

  const practitioners = useSuspenseQuery(
    orpc.staff.listPractitioners.queryOptions({ input: { orgSlug } }),
  ).data;

  return (
    <>
      <PageHeader title="Appointment" description={formatBusinessDate(today)} />
      <PageBody className="mx-auto w-full max-w-6xl pb-24 lg:pb-4">
        <OpdIntakeForm
          // The seed only feeds the form's defaults, so a new `?customerId` remounts it.
          key={seedCustomer?.id ?? ""}
          orgSlug={orgSlug}
          seedCustomer={seedCustomer}
          departments={departments}
          practitioners={practitioners}
        />
      </PageBody>
    </>
  );
}
