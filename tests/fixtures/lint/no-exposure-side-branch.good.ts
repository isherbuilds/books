import { documentRole } from "@accly/api/core/document-roles";

export const isRefund = (payment: { exposureSide: "receivable" | "payable" | null }) =>
  documentRole({ type: "payment", exposureSide: payment.exposureSide }).refund === true;

export const unsided = (row: { exposureSide: string | null }) => row.exposureSide === null;
