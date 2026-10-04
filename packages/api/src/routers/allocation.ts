import { db } from "@accly/db";
import { z } from "zod";

import { audit } from "../audit";
import { applyAllocations, reverseAllocation } from "../core/allocations";
import { formatDecimal } from "../core/money";
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

      return applyAllocations(tx, scope, settings, {
        pairs: [
          {
            sourceDocumentId: input.sourceDocumentId,
            targetDocumentId: input.targetDocumentId,
            amountPaise: input.amount,
          },
        ],
        draftDocumentId: null,
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

      return reverseAllocation(tx, scope, settings, input.allocationId, input.reason);
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
