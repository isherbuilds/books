import type { RouterClient } from "@orpc/server";

import { accountRouter } from "./account";
import { auditRouter } from "./audit";
import { exportRouter } from "./export";
import { fileRouter } from "./file";
import { memberRouter } from "./member";
import { organizationRouter } from "./organization";
import { paymentMethodRouter } from "./payment-method";
import { partyRouter } from "./party";
import { paymentRouter } from "./payment";
import { receiptRouter } from "./receipt";
import { settingsRouter } from "./settings";

export const appRouter = {
  account: accountRouter,
  audit: auditRouter,
  file: fileRouter,
  export: exportRouter,
  member: memberRouter,
  organization: organizationRouter,
  paymentMethod: paymentMethodRouter,
  party: partyRouter,
  payment: paymentRouter,
  receipt: receiptRouter,
  settings: settingsRouter,
};

export type AppRouter = typeof appRouter;

export type AppRouterClient = RouterClient<typeof appRouter>;
