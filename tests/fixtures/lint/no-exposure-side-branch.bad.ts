export const isRefund = (payment: { exposureSide: "receivable" | "payable" | null }) =>
  payment.exposureSide === "receivable";
