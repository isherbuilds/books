import { db } from "@accly/db";
import { z } from "zod";

import { audit } from "../audit";
import { applyAllocations, reverseAllocation } from "../core/allocations";
import { assertPeriodOpen } from "../core/locks";
import { formatDecimal } from "../core/money";
import { businessDate } from "../lib/business-date";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { positiveMoney, reason } from "../lib/schemas";
import { orgSettings } from "../lib/settlements";

export const allocationRouter = {
  apply: orgProcedure(
    { allocation: ["apply"] },
    orgInput.extend({
      sourceDocumentId: z.uuid(),
      targetDocumentId: z.uuid(),
      amount: positiveMoney,
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    const rows = await db.transaction(async (tx) => {
      const settings = await orgSettings(scope.orgId, tx);
      const entryDate = businessDate(new Date(), settings.timeZone);
      await assertPeriodOpen(tx, scope, settings, { entryDate, affectsTax: false });

      return applyAllocations(tx, scope, {
        pairs: [
          {
            sourceDocumentId: input.sourceDocumentId,
            targetDocumentId: input.targetDocumentId,
            amountPaise: input.amount,
          },
        ],
        draftDocumentId: null,
        entryDate,
      });
    });

    audit({
      action: "allocation.apply",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `document:${input.sourceDocumentId}`,
      meta: {
        allocationIds: rows.map((row) => row.id),
        targetDocumentId: input.targetDocumentId,
        amount: formatDecimal(input.amount),
      },
    });

    return rows;
  }),

  reverse: orgProcedure(
    { allocation: ["reverse"] },
    orgInput.extend({ allocationId: z.uuid(), reason }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    const reversed = await db.transaction(async (tx) => {
      const settings = await orgSettings(scope.orgId, tx);
      const entryDate = businessDate(new Date(), settings.timeZone);
      await assertPeriodOpen(tx, scope, settings, { entryDate, affectsTax: false });

      return reverseAllocation(tx, scope, input.allocationId, entryDate, input.reason);
    });

    audit({
      action: "allocation.reverse",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `allocation:${input.allocationId}`,
      meta: {
        reversalId: reversed.id,
        amount: formatDecimal(reversed.amountPaise),
        reason: input.reason,
      },
    });

    return reversed;
  }),
};
