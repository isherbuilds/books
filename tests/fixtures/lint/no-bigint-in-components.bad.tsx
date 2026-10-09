export function Total({ paise }: { paise: bigint }) {
  return <span>{paise === 0n ? "Nil" : "Due"}</span>;
}
