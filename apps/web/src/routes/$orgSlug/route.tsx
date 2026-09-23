import { businessDate } from "@accly/api/lib/business-date";
import { ClientOnly, Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";
import { Palette } from "@/components/palette/palette";
import { membershipOptions } from "@/lib/membership";
import { hasErrorCode } from "@/lib/orpc-error";

export const Route = createFileRoute("/$orgSlug")({
  ssr: true,
  loader: async ({ context: { queryClient }, location, params: { orgSlug } }) => {
    let membership;

    try {
      membership = await queryClient.query(membershipOptions(orgSlug));
    } catch (error) {
      if (hasErrorCode(error, "UNAUTHORIZED")) {
        throw redirect({ to: "/login", search: { redirect: location.href } });
      }

      if (hasErrorCode(error, "FORBIDDEN")) {
        throw redirect({ to: "/join" });
      }

      throw error;
    }

    return {
      timeZone: membership.timeZone,
      today: businessDate(new Date(), membership.timeZone),
      financialYearStart: membership.financialYearStart,
    };
  },
  component: OrgLayout,
});

function OrgLayout() {
  const { orgSlug } = Route.useParams();

  return (
    <AppShell orgSlug={orgSlug}>
      <Outlet />
      <ClientOnly fallback={null}>
        <Palette orgSlug={orgSlug} />
      </ClientOnly>
    </AppShell>
  );
}
