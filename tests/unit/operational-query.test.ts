import { expect, test } from "bun:test";

import { OPERATIONAL_INFINITE_REFETCH } from "../../apps/web/src/lib/operational-query";
import { errorReason } from "../../apps/web/src/lib/orpc-error";

test("operational lists poll page one only and stay focus-aware", () => {
  const onePage = { state: { data: { pages: [1] } } };
  const twoPages = { state: { data: { pages: [1, 2] } } };

  expect(OPERATIONAL_INFINITE_REFETCH.refetchInterval(onePage)).toBe(10_000);
  expect(OPERATIONAL_INFINITE_REFETCH.refetchInterval(twoPages)).toBe(false);
  expect(OPERATIONAL_INFINITE_REFETCH.refetchOnWindowFocus(onePage)).toBe(true);
  expect(OPERATIONAL_INFINITE_REFETCH.staleTime).toBeLessThan(60_000);
  // A shared placeholder would bridge results across orgSlug changes, exposing the
  // prior organization's rows under the new route.
  expect(OPERATIONAL_INFINITE_REFETCH).not.toHaveProperty("placeholderData");
});

test("a conflict reason survives the transport's cause wrapper", () => {
  expect(errorReason({ cause: { data: { reason: "STALE_RECORD" } } })).toBe("STALE_RECORD");
  expect(errorReason({ code: "BAD_REQUEST" })).toBeUndefined();
});
