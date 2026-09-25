import { orpc } from "@/lib/orpc";

// Every role reads settings; the organization page and the bill form share one entry.
export const settingsOptions = (orgSlug: string) =>
  orpc.settings.get.queryOptions({ input: { orgSlug } });
