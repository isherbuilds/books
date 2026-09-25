import { authorize } from "@accly/auth/access";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { membershipOptions } from "@/lib/membership";
import { SETTINGS_TABS } from "@/lib/navigation";

// An address, not a page: resolves to the first tab this member can open. The tab
// loaders gate on the same cached membership, so the redirect cannot loop.
export const Route = createFileRoute("/$orgSlug/settings/")({
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    const membership = await queryClient.query(membershipOptions(orgSlug));

    const first = SETTINGS_TABS.find(({ permission }) => authorize(membership.roles, permission));
    throw redirect({
      to: first?.to ?? "/$orgSlug",
      params: { orgSlug },
    });
  },
});
