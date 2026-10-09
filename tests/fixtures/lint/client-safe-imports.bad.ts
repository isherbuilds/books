import { db } from "@accly/db";
import { appRouter } from "@accly/api/routers/index";

export { db as reexported } from "@accly/db";
export * from "@accly/db";

export const both = [db, appRouter];
export const lazy = () => import("@accly/db");
export const lazyTemplate = () => import(`@accly/db`);
