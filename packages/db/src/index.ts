import { env } from "@accly/env/server";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema";

// Connections, not CPU, are the scarce resource. Migrations open their own client
// and are deliberately not bound by this pool. A request that cannot get one of the
// 10 connections within 5 s fails loudly instead of queueing without limit.
export const db = drizzle({
  connection: {
    connectionString: env.DATABASE_URL,
    statement_timeout: 15_000,
    connectionTimeoutMillis: 5_000,
  },
  schema,
});

export type DbTransaction = Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];
