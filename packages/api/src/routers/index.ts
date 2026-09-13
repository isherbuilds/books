import type { RouterClient } from "@orpc/server";

import { accountRouter } from "./account";
import { auditRouter } from "./audit";
import { billingRouter } from "./billing";
import { itemRouter } from "./item";
import { dashboardRouter } from "./dashboard";
import { exportRouter } from "./export";
import { fileRouter } from "./file";
import { memberRouter } from "./member";
import { organizationRouter } from "./organization";
import { paymentMethodRouter } from "./payment-method";
import { partyRouter } from "./party";
import { customerRouter } from "./customer";
import { payerRouter } from "./payer";
import { reportRouter } from "./report";
import { receiptRouter } from "./receipt";
import { settingsRouter } from "./settings";
import { staffRouter } from "./staff";
import { opdRouter } from "./opd";

export const appRouter = {
  account: accountRouter,
  audit: auditRouter,
  billing: billingRouter,
  item: itemRouter,
  dashboard: dashboardRouter,
  file: fileRouter,
  export: exportRouter,
  member: memberRouter,
  organization: organizationRouter,
  paymentMethod: paymentMethodRouter,
  party: partyRouter,
  customer: customerRouter,
  payer: payerRouter,
  report: reportRouter,
  receipt: receiptRouter,
  settings: settingsRouter,
  staff: staffRouter,
  opd: opdRouter,
};

export type AppRouter = typeof appRouter;

export type AppRouterClient = RouterClient<typeof appRouter>;
