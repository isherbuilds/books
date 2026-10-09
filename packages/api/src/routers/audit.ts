import { db } from "@accly/db";
import { auditLog } from "@accly/db/schema/audit";
import { user } from "@accly/db/schema/auth";
import { and, desc, eq, gte, ilike, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { likePattern, orderedPeriod, pageLimit, period, searchQuery } from "../lib/schemas";
import { orgTimeZone } from "../lib/org-settings";
import { pageOf } from "../lib/pagination";

export const auditRouter = {
  list: orgProcedure(
    { audit: ["read"] },
    orgInput
      .extend({
        cursor: z.number().int().positive().optional(),
        q: searchQuery,
        ...period,
        limit: pageLimit,
      })
      .superRefine(orderedPeriod),
  ).handler(async ({ context, input }) => {
    const timeZone = input.from || input.to ? await orgTimeZone(context.scope.orgId) : null;
    const q = input.q ? likePattern(input.q) : null;

    const filters = and(
      eq(auditLog.orgId, context.scope.orgId),
      input.cursor ? lt(auditLog.id, input.cursor) : undefined,
      input.from
        ? gte(auditLog.createdAt, sql`${input.from}::date::timestamp AT TIME ZONE ${timeZone}`)
        : undefined,
      input.to
        ? lt(auditLog.createdAt, sql`(${input.to}::date + 1)::timestamp AT TIME ZONE ${timeZone}`)
        : undefined,
      // One box: the person who acted, or a value in the details (a document number,
      // a member's name or email, a file name). Values only, never the JSON keys.
      q
        ? or(
            ilike(user.name, q),
            ilike(user.email, q),
            sql`exists (select 1 from jsonb_each_text(${auditLog.meta}) as detail where detail.value ilike ${q})`,
          )
        : undefined,
    );

    // LEFT JOIN, not a foreign key: entries outlive the accounts they name, so a
    // deleted actor still shows up as a row.
    const rows = await db
      .select({
        entry: auditLog,
        actorName: user.name,
        actorEmail: user.email,
      })
      .from(auditLog)
      .leftJoin(user, eq(auditLog.actorId, user.id))
      .where(filters)
      .orderBy(desc(auditLog.id))
      .limit(input.limit + 1);

    return pageOf(
      rows.map(({ entry, actorName, actorEmail }) => ({ ...entry, actorName, actorEmail })),
      input.limit,
      (last) => last.id,
    );
  }),
};
