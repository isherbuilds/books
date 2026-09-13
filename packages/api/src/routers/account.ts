import { db } from "@accly/db";
import { ACCOUNT_TYPES, accounts } from "@accly/db/schema/accounts";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { capMasterList, MASTER_LIST_LIMIT } from "../lib/master-list";
import { orgInput, orgProcedure } from "../lib/procedures/factory";

export const accountRouter = {
  list: orgProcedure(
    { account: ["read"] },
    orgInput.extend({
      type: z.enum(ACCOUNT_TYPES).optional(),
      activeOnly: z.boolean().optional(),
    }),
  ).handler(async ({ context, input }) => {
    const rows = await db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.orgId, context.scope.orgId),
          input.type ? eq(accounts.type, input.type) : undefined,
          input.activeOnly ? eq(accounts.active, true) : undefined,
        ),
      )
      .orderBy(asc(accounts.code), asc(accounts.id))
      .limit(MASTER_LIST_LIMIT + 1);

    return capMasterList(rows);
  }),
};
