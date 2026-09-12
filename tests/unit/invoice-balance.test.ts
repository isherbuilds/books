import { expect, test } from "bun:test";

import { parseMoney } from "@accly/api/core/money";
import { invoiceBalancesFor } from "@accly/api/lib/invoice-balance";

test("loads invoice movement totals in one database round trip", async () => {
  let calls = 0;

  // SAFETY: This fixture supplies the exact rows consumed by invoiceBalancesFor; no other query uses it.
  const executor = {
    execute: async () => {
      calls += 1;

      return {
        rows: [
          {
            invoiceId: "invoice-1",
            creditTotal: "2500",
            paymentsTotal: "8000",
            refundsTotal: "500",
          },
        ],
      };
    },
  } as unknown as Parameters<typeof invoiceBalancesFor>[0];

  const balances = await invoiceBalancesFor(executor, "org-1", [
    { id: "invoice-1", grandTotal: parseMoney("100.00") },
    { id: "invoice-2", grandTotal: parseMoney("40.00") },
  ]);

  expect(calls).toBe(1);
  expect(balances.get("invoice-1")).toEqual({
    grandTotal: parseMoney("100.00"),
    creditTotal: parseMoney("25.00"),
    paymentsTotal: parseMoney("80.00"),
    refundsTotal: parseMoney("5.00"),
    outstanding: parseMoney("0.00"),
  });
  expect(balances.get("invoice-2")?.outstanding).toBe(parseMoney("40.00"));
});
