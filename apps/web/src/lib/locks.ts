import type { LockKind } from "@accly/db/schema/period-locks";

import { orpc } from "@/lib/orpc";

export const LOCK_KIND_LABELS = {
  general: "Books",
  tax: "Tax period",
} satisfies Record<LockKind, string>;

export const lockStateOptions = (orgSlug: string) =>
  orpc.lock.get.queryOptions({ input: { orgSlug } });
