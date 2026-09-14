import { authorize, type AppPermission } from "@accly/auth/access";
import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";

import { membershipOptions, type Membership } from "@/lib/membership";

// `permission` must be the whole set the page needs to function, not just the one
// its name suggests — a page that renders but cannot submit is the same denial
// arriving later. Every gated page is a settings page, so a denial lands on its index,
// which picks the first tab the member may open.
export async function requireOrgPermission(
  queryClient: QueryClient,
  orgSlug: string,
  permission: AppPermission,
): Promise<Membership> {
  const membership = await queryClient.query(membershipOptions(orgSlug));

  if (!authorize(membership.roles, permission)) {
    throw redirect({ to: "/$orgSlug/settings", params: { orgSlug } });
  }

  return membership;
}
