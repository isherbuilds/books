import { expect, test } from "bun:test";

type QueryKey = readonly unknown[];

const previousSkip = process.env.SKIP_ENV_VALIDATION;

process.env.SKIP_ENV_VALIDATION = "true";

const { invalidateDocumentState } = await import("../../apps/web/src/lib/domain-invalidation");

if (previousSkip === undefined) {
  delete process.env.SKIP_ENV_VALIDATION;
} else {
  process.env.SKIP_ENV_VALIDATION = previousSkip;
}

function recordingInvalidator() {
  const keys: QueryKey[] = [];

  return {
    keys,
    client: {
      invalidateQueries: async ({ queryKey }: { queryKey: QueryKey }) => {
        keys.push(queryKey);
      },
    },
  };
}

test("document invalidation scopes every key to the org and refreshes money balances", async () => {
  const { client, keys } = recordingInvalidator();
  await invalidateDocumentState(client, "org-a");

  const emitted = keys.map((key) => JSON.stringify(key));
  expect(emitted.length).toBeGreaterThan(0);

  for (const key of emitted) expect(key).toContain('"orgSlug":"org-a"');
  expect(emitted.some((key) => key.includes('"receiptId"'))).toBe(false);
  expect(emitted.some((key) => key.includes('"account","moneyBalances"'))).toBe(true);
});
