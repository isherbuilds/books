import type { RouterClient } from "@orpc/server";

import { accountRouter } from "./account";
import { allocationRouter } from "./allocation";
import { auditRouter } from "./audit";
import { exportRouter } from "./export";
import { fileRouter } from "./file";
import { invoiceRouter } from "./invoice";
import { itemRouter } from "./item";
import { journalRouter } from "./journal";
import { memberRouter } from "./member";
import { organizationRouter } from "./organization";
import { partyRouter } from "./party";
import { paymentRouter } from "./payment";
import { paymentMethodRouter } from "./payment-method";
import { receiptRouter } from "./receipt";
import { settingsRouter } from "./settings";

export const appRouter = {
  account: accountRouter,
  allocation: allocationRouter,
  audit: auditRouter,
  export: exportRouter,
  file: fileRouter,
  invoice: invoiceRouter,
  item: itemRouter,
  journal: journalRouter,
  member: memberRouter,
  organization: organizationRouter,
  party: partyRouter,
  payment: paymentRouter,
  paymentMethod: paymentMethodRouter,
  receipt: receiptRouter,
  settings: settingsRouter,
};

export type AppRouter = typeof appRouter;

export type AppRouterClient = RouterClient<typeof appRouter>;
