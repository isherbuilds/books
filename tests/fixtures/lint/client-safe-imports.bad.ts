import { db } from "@accly/db";
import { appRouter } from "@accly/api/routers/index";

export const both = [db, appRouter];
