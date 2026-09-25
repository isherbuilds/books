import { ZERO_MONEY, formatMoney } from "@accly/api/core/money";
import type { ReactNode } from "react";

import { DetailRow } from "@/components/detail-row";

/**
 * The server's subtotal, discount, taxable, tax, round-off and total for a saved Invoice
 * or Bill. `children` follow the total, such as a Bill's TDS.
 */
export function DocumentTotals({
  document,
  children,
}: {
  document: {
    lines: readonly {
      amountPaise: bigint;
      cgstPaise: bigint;
      sgstPaise: bigint;
      igstPaise: bigint;
    }[];
    discountPaise: bigint;
    roundOffPaise: bigint;
    totalPaise: bigint;
  };
  children?: ReactNode;
}) {
  let taxablePaise = ZERO_MONEY;
  let taxPaise = ZERO_MONEY;

  for (const line of document.lines) {
    taxablePaise += line.amountPaise;
    taxPaise += line.cgstPaise + line.sgstPaise + line.igstPaise;
  }

  return (
    <dl className="grid gap-2">
      {document.discountPaise > ZERO_MONEY ? (
        <>
          <DetailRow label="Subtotal">
            {formatMoney(taxablePaise + document.discountPaise)}
          </DetailRow>
          <DetailRow label="Discount">−{formatMoney(document.discountPaise)}</DetailRow>
        </>
      ) : null}
      <DetailRow label="Taxable">{formatMoney(taxablePaise)}</DetailRow>
      <DetailRow label="Tax">{formatMoney(taxPaise)}</DetailRow>
      <DetailRow label="Round-off">{formatMoney(document.roundOffPaise)}</DetailRow>
      <div className="flex items-baseline justify-between gap-4 font-medium">
        <dt>Total</dt>
        <dd className="tabular-nums">{formatMoney(document.totalPaise)}</dd>
      </div>
      {children}
    </dl>
  );
}
