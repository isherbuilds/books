import { sql } from "drizzle-orm";

export const total = (column: unknown) => sql<bigint>`SUM(${column})::bigint`;
