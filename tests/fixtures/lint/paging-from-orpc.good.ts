import { nextPage, orpc } from "@/lib/orpc";

export const options = (orgSlug: string) =>
  orpc.item.list.infiniteOptions({ input: () => ({ orgSlug }), ...nextPage });
