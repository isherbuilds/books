import { isZeroMoney } from "@accly/api/core/money";

export function Total({ paise }: { paise: bigint }) {
  return <span>{isZeroMoney(paise) ? "Nil" : "Due"}</span>;
}
