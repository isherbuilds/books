import { parseMoney } from "@accly/api/core/money";
import { Separator } from "@accly/ui/components/separator";
import { type ReactNode } from "react";

import { formatMoney } from "@/lib/money";
import { type WalkInQuote } from "@/lib/opd-service-preview";

export function FinancialSummary({
  quote,
  discountRow,
}: {
  quote: WalkInQuote;
  discountRow?: ReactNode;
}) {
  const { currency } = quote;

  return (
    <dl className="grid gap-2">
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Subtotal</dt>
        <dd className="tabular-nums">{formatMoney(quote.subtotal, currency)}</dd>
      </div>
      {discountRow ??
        (parseMoney(quote.discountAmount) > 0n ? (
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Discount</dt>
            <dd className="tabular-nums">-{formatMoney(quote.discountAmount, currency)}</dd>
          </div>
        ) : null)}
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Tax</dt>
        <dd className="tabular-nums">{formatMoney(quote.taxTotal, currency)}</dd>
      </div>
      <Separator />
      <div className="flex items-baseline justify-between pt-1 text-sm font-medium">
        <dt>Payable</dt>
        <dd className="tabular-nums">{formatMoney(quote.grandTotal, currency)}</dd>
      </div>
    </dl>
  );
}
