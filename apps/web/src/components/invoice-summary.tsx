import { ZERO_MONEY, formatMoney } from "@accly/api/core/money";
import type { AppRouterClient } from "@accly/api/routers/index";
import { cn } from "@accly/ui/lib/utils";
import type { ReactNode } from "react";

import { DetailRow } from "@/components/detail-row";
import { subtotalBeforeDiscountPaise } from "@/lib/invoices";

// An ink rule above the total and the closing double rule under it (globals.css).
const TOTAL_ROW =
  "flex items-baseline justify-between gap-4 border-t border-foreground pt-2 font-medium";

const TOTAL_AMOUNT = "closing-total tabular-nums";

type TaxTotals = {
  cgstPaise: bigint;
  sgstPaise: bigint;
  igstPaise: bigint;
  roundOffPaise: bigint;
  totalPaise: bigint;
};

/** GST, round-off and the ruled total: the rows a saved document and the editor share. */
function TaxRows({ totals }: { totals: TaxTotals }) {
  const { cgstPaise, sgstPaise, igstPaise } = totals;

  return (
    <>
      {cgstPaise > ZERO_MONEY ? <DetailRow label="CGST">{formatMoney(cgstPaise)}</DetailRow> : null}
      {sgstPaise > ZERO_MONEY ? <DetailRow label="SGST">{formatMoney(sgstPaise)}</DetailRow> : null}
      {igstPaise > ZERO_MONEY ? <DetailRow label="IGST">{formatMoney(igstPaise)}</DetailRow> : null}
      <DetailRow label="Round-off">{formatMoney(totals.roundOffPaise)}</DetailRow>
      <div className={TOTAL_ROW}>
        <dt>Total</dt>
        <dd className={TOTAL_AMOUNT}>{formatMoney(totals.totalPaise)}</dd>
      </div>
    </>
  );
}

/**
 * The server's subtotal, discount, taxable, GST, round-off and total for a saved Invoice
 * or Bill. A GST component shows only when it was levied. `children` follow the total,
 * such as a Bill's TDS.
 */
export function DocumentTotals({
  document,
  children,
}: {
  document: {
    totals: { taxablePaise: bigint; cgstPaise: bigint; sgstPaise: bigint; igstPaise: bigint };
    discountPaise: bigint;
    roundOffPaise: bigint;
    totalPaise: bigint;
  };
  children?: ReactNode;
}) {
  const { taxablePaise } = document.totals;

  return (
    <dl className="grid gap-2">
      {document.discountPaise > ZERO_MONEY ? (
        <>
          <DetailRow label="Subtotal">
            {formatMoney(subtotalBeforeDiscountPaise(taxablePaise, document.discountPaise))}
          </DetailRow>
          <DetailRow label="Discount">{formatMoney(-document.discountPaise)}</DetailRow>
        </>
      ) : null}
      <DetailRow label="Taxable">{formatMoney(taxablePaise)}</DetailRow>
      <TaxRows
        totals={{
          ...document.totals,
          roundOffPaise: document.roundOffPaise,
          totalPaise: document.totalPaise,
        }}
      />
      {children}
    </dl>
  );
}

type InvoiceQuote = Awaited<ReturnType<AppRouterClient["invoice"]["quote"]>>;

/**
 * The editor's live totals. The subtotal is quantity times rate, known at once; tax,
 * round-off and total come from the server's quote, so they match what posts. While a
 * newer quote is on its way the last one's figures stay, dimmed.
 */
export function InvoiceTotalsPanel({
  subtotalPaise,
  quote,
  stale,
  error,
  discount,
  children,
}: {
  subtotalPaise: bigint;
  quote: InvoiceQuote | undefined;
  stale: boolean;
  error: string | null;
  /** The bill-level discount input, which sits in its row. */
  discount: ReactNode;
  /** The Received payment lines. */
  children?: ReactNode;
}) {
  return (
    <section aria-label="Totals" className="grid gap-2">
      <dl className="grid gap-2">
        <DetailRow label="Subtotal">{formatMoney(subtotalPaise)}</DetailRow>
        <div className="flex items-start justify-between gap-4">
          <dt className="pt-2 text-muted-foreground">Discount</dt>
          <dd className="w-44">{discount}</dd>
        </div>
      </dl>
      {quote ? (
        <dl className={cn("grid gap-2", stale && "opacity-60")}>
          {quote.discountPaise > ZERO_MONEY ? (
            <DetailRow label="Taxable">{formatMoney(quote.taxablePaise)}</DetailRow>
          ) : null}
          <TaxRows totals={quote} />
        </dl>
      ) : (
        <dl className="grid gap-2">
          <div className={TOTAL_ROW}>
            <dt>Total</dt>
            <dd>—</dd>
          </div>
        </dl>
      )}
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      {children}
    </section>
  );
}
