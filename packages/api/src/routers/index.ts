import type { RouterClient } from "@orpc/server";

import { accountRouter } from "./account";
import { allocationRouter } from "./allocation";
import { auditRouter } from "./audit";
import { billRouter } from "./bill";
import { exportRouter } from "./export";
import { fileRouter } from "./file";
import { invoiceRouter } from "./invoice";
import { itemRouter } from "./item";
import { journalRouter } from "./journal";
import { lockRouter } from "./lock";
import { memberRouter } from "./member";
import { noteRouter } from "./note";
import { openingBalanceRouter } from "./opening-balance";
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
  bill: billRouter,
  export: exportRouter,
  file: fileRouter,
  invoice: invoiceRouter,
  item: itemRouter,
  journal: journalRouter,
  lock: lockRouter,
  member: memberRouter,
  note: noteRouter,
  openingBalance: openingBalanceRouter,
  organization: organizationRouter,
  party: partyRouter,
  payment: paymentRouter,
  paymentMethod: paymentMethodRouter,
  receipt: receiptRouter,
  settings: settingsRouter,
};

export type AppRouter = typeof appRouter;

export type AppRouterClient = RouterClient<typeof appRouter>;
