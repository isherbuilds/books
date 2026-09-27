import { businessDate } from "@accly/api/lib/business-date";
import type { QueryClient } from "@tanstack/react-query";
import { redirect, type ParsedLocation } from "@tanstack/react-router";
import { z } from "zod";

import { presetRange, type Preset, type SearchRange } from "@/lib/date-presets";
import { membershipOptions } from "@/lib/membership";

/** A dated page's search fields; `all` is the explicit "All time". */
export const periodSearch = {
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  all: z.boolean().optional().catch(undefined),
};

/**
 * A register or statement opened without dates moves to its default period, written
 * into the URL, so an unbounded history is always an explicit "All time". Search text
 * or a party filter already makes the page a lookup, which keeps the whole history.
 */
export async function requirePeriod(
  queryClient: QueryClient,
  orgSlug: string,
  location: ParsedLocation,
  search: SearchRange & { q?: string; partyId?: string },
  preset: Preset,
): Promise<void> {
  if (search.from || search.to || search.all || search.q || search.partyId) return;

  const { timeZone, financialYearStart } = await queryClient.query(membershipOptions(orgSlug));
  const period = presetRange(preset, businessDate(new Date(), timeZone), financialYearStart);

  throw redirect({
    to: location.pathname,
    search: { ...location.search, ...period },
    replace: true,
  });
}
