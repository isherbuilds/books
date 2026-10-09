import { formatMoney } from "@accly/api/core/money";
import type { UseQueryResult } from "@tanstack/react-query";

type Totals = {
  count: number;
  totalPaise: bigint;
  methods?: { name: string; amountPaise: bigint }[];
};

/** One line under a register's filters: "12 receipts · ₹4,500.00 · Cash ₹500.00 · UPI ₹4,000.00". */
export function RegisterTotals({ query, noun }: { query: UseQueryResult<Totals>; noun: string }) {
  if (query.isError) {
    return <p className="text-sm text-muted-foreground">Could not load the totals.</p>;
  }

  const parts = query.data
    ? [
        `${query.data.count.toLocaleString("en-IN")} ${query.data.count === 1 ? noun : `${noun}s`}`,
        formatMoney(query.data.totalPaise),
        ...(query.data.methods && query.data.methods.length > 1
          ? query.data.methods.map((method) => `${method.name} ${formatMoney(method.amountPaise)}`)
          : []),
      ]
    : [];

  return (
    <p aria-live="polite" className="min-h-5 text-sm tabular-nums text-muted-foreground">
      {parts.join(" · ")}
    </p>
  );
}
