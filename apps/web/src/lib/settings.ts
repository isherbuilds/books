import { nextPage, orpc } from "@/lib/orpc";

// Every role reads settings; the organization page and the bill form share one entry.
export const settingsOptions = (orgSlug: string) =>
  orpc.settings.get.queryOptions({ input: { orgSlug } });

// `staleTime: 0`: every sensitive mutation writes here, so the trail refetches on
// every visit rather than relying on each mutation to invalidate it.
export const auditListOptions = (
  orgSlug: string,
  filters: { q?: string; from?: string; to?: string },
) =>
  orpc.audit.list.infiniteOptions({
    input: (cursor: number | undefined) => ({ orgSlug, cursor, ...filters }),
    ...nextPage,
    staleTime: 0,
  });
