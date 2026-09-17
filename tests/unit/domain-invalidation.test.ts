import { expect, test } from "bun:test";

type QueryKey = readonly unknown[];

const previousSkip = process.env.SKIP_ENV_VALIDATION;

process.env.SKIP_ENV_VALIDATION = "true";

const { invalidateCashState, invalidateInvoiceDrafts, invalidateSettlementState } =
  await import("../../apps/web/src/lib/domain-invalidation");

if (previousSkip === undefined) {
  delete process.env.SKIP_ENV_VALIDATION;
} else {
  process.env.SKIP_ENV_VALIDATION = previousSkip;
}

function recordingInvalidator() {
  const keys: string[] = [];

  return {
    keys,
    client: {
      invalidateQueries: async ({ queryKey }: { queryKey: QueryKey }) => {
        keys.push(JSON.stringify(queryKey));
      },
    },
  };
}

test("each invalidation set scopes to the org and widens only for what the write moved", async () => {
  const drafts = recordingInvalidator();
  await invalidateInvoiceDrafts(drafts.client, "org-a");
  expect(drafts.keys).toHaveLength(1);
  expect(drafts.keys[0]).toContain('"invoice"');

  const settlement = recordingInvalidator();
  await invalidateSettlementState(settlement.client, "org-a");
  expect(settlement.keys.some((key) => key.includes('"receipt"'))).toBe(true);
  expect(settlement.keys.some((key) => key.includes('"account","moneyBalances"'))).toBe(false);

  const cash = recordingInvalidator();
  await invalidateCashState(cash.client, "org-a");
  expect(cash.keys.some((key) => key.includes('"account","moneyBalances"'))).toBe(true);

  for (const key of [...drafts.keys, ...settlement.keys, ...cash.keys]) {
    expect(key).toContain('"orgSlug":"org-a"');
    expect(key).not.toContain('"receiptId"');
  }
});
