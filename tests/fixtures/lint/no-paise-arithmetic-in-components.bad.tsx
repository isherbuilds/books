export function Total({ row }: { row: { taxablePaise: bigint; discountPaise: bigint } }) {
  return <span>{String(row.taxablePaise + row.discountPaise)}</span>;
}
