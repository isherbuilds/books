import type { AppRouter } from "@accly/api/routers/index";
import { authorize, type AppPermission } from "@accly/auth/access";
import type { RouterClient } from "@orpc/server";
import { useSuspenseQuery } from "@tanstack/react-query";

import { orpc } from "@/lib/orpc";

export type Membership = Awaited<ReturnType<RouterClient<AppRouter>["member"]["me"]>>;

// The `/$orgSlug` loader runs on every navigation. Roles change rarely and the server
// re-checks each call, so five minutes of reuse spares most navigations a blocking
// round trip; member and settings edits invalidate it at once.
export const membershipOptions = (orgSlug: string) => ({
  ...orpc.member.me.queryOptions({ input: { orgSlug } }),
  staleTime: 5 * 60_000,
});

/**
 * The only way to read membership. The `/$orgSlug` loader awaits `member.me`, so it
 * is always cached here and never pending or failed — a `useQuery` beside this one
 * only adds branches that cannot run.
 *
 * `select` runs on every render, so keep it an allocation-free projection. Narrow to
 * the field you render: the whole object wakes on any settings edit.
 */
export function useMembership(orgSlug: string): Membership;
export function useMembership<T>(orgSlug: string, select: (membership: Membership) => T): T;
export function useMembership<T>(orgSlug: string, select?: (membership: Membership) => T) {
  return useSuspenseQuery({ ...membershipOptions(orgSlug), select }).data;
}

export function useCan(orgSlug: string, permission: AppPermission): boolean {
  return useMembership(orgSlug, (membership) => authorize(membership.roles, permission));
}
