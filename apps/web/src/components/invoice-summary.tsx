import { ZERO_MONEY, formatMoney } from "@accly/api/core/money";
import type { ReactNode } from "react";

import { DetailRow } from "@/components/detail-row";

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
  const { taxablePaise, cgstPaise, sgstPaise, igstPaise } = document.totals;

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
      {cgstPaise > ZERO_MONEY ? <DetailRow label="CGST">{formatMoney(cgstPaise)}</DetailRow> : null}
      {sgstPaise > ZERO_MONEY ? <DetailRow label="SGST">{formatMoney(sgstPaise)}</DetailRow> : null}
      {igstPaise > ZERO_MONEY ? <DetailRow label="IGST">{formatMoney(igstPaise)}</DetailRow> : null}
      <DetailRow label="Round-off">{formatMoney(document.roundOffPaise)}</DetailRow>
      <div className="flex items-baseline justify-between gap-4 font-medium">
        <dt>Total</dt>
        <dd className="tabular-nums">{formatMoney(document.totalPaise)}</dd>
      </div>
      {children}
    </dl>
  );
}
