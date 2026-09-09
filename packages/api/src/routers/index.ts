import type { RouterClient } from "@orpc/server";

import { auditRouter } from "./audit";
import { billingRouter } from "./billing";
import { itemRouter } from "./item";
import { dashboardRouter } from "./dashboard";
import { fileRouter } from "./file";
import { memberRouter } from "./member";
import { customerRouter } from "./customer";
import { payerRouter } from "./payer";
import { reportRouter } from "./report";
import { settingsRouter } from "./settings";
import { staffRouter } from "./staff";
import { opdRouter } from "./opd";

export const appRouter = {
  audit: auditRouter,
  billing: billingRouter,
  item: itemRouter,
  dashboard: dashboardRouter,
  file: fileRouter,
  member: memberRouter,
  customer: customerRouter,
  payer: payerRouter,
  report: reportRouter,
  settings: settingsRouter,
  staff: staffRouter,
  opd: opdRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
