import { formatMoney } from "@accly/api/core/money";
import type { AppRouter } from "@accly/api/routers/index";
import { type Scope } from "@accly/api/lib/procedures/factory";
import { SETTLEMENT_KINDS } from "@accly/db/schema/settlement-kinds";

export type Both = [AppRouter, Scope];
export const shown = [formatMoney, SETTLEMENT_KINDS];
