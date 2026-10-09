import { Input } from "@accly/ui/components/input";
import { cn } from "@accly/ui/lib/utils";
import type { ComponentProps } from "react";

/**
 * A money field (design system AmountField): the decimal keypad and right-aligned
 * tabular digits. The value stays the typed decimal; the grouped figure shows beside
 * it (line amounts, totals). `symbol` adds the ₹ prefix for a standalone field; a
 * grid column carries the currency in its header instead.
 */
export function AmountInput({
  symbol,
  className,
  ...props
}: ComponentProps<typeof Input> & { symbol?: boolean }) {
  const input = (
    <Input
      inputMode="decimal"
      autoComplete="off"
      placeholder="0.00"
      {...props}
      className={cn("min-w-32 text-right tabular-nums", symbol && "pl-6", className)}
    />
  );

  if (!symbol) return input;

  return (
    <div className="relative min-w-32">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-muted-foreground"
      >
        ₹
      </span>
      {input}
    </div>
  );
}
