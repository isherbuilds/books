import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/lib/orpc";

export function Items({ orgSlug }: { orgSlug: string }) {
  const items = useQuery(orpc.item.list.queryOptions({ input: { orgSlug } }));
  return <span>{items.data?.rows.length}</span>;
}
