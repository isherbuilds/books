import { useQuery } from "@tanstack/react-query";

import { itemListOptions } from "@/lib/items";

export function Items({ orgSlug }: { orgSlug: string }) {
  const items = useQuery(itemListOptions(orgSlug));
  return <span>{items.data?.rows.length}</span>;
}
