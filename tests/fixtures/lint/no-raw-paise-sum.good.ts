import { sql } from "drizzle-orm";

import { paiseSum } from "../lib/sql";

export const total = (column: Parameters<typeof paiseSum>[0]) => paiseSum(column);
export const summary = sql`count(*)`;
