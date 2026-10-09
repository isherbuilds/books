import { subtotalBeforeDiscountPaise } from "@/lib/invoices";

export function Total({ row }: { row: { taxablePaise: bigint; discountPaise: bigint } }) {
  return <span>{String(subtotalBeforeDiscountPaise(row.taxablePaise, row.discountPaise))}</span>;
}
