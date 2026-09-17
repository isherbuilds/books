import { db } from "@accly/db";
import { z } from "zod";

import { audit } from "../audit";
import { applyAllocations, reverseAllocation } from "../core/allocations";
import { formatDecimal } from "../core/money";
import { recordEntry } from "../core/posting";
import { businessDate } from "../lib/business-date";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { positiveMoney, reason } from "../lib/schemas";
import { orgTimeZone } from "../lib/settlements";

export const allocationRouter = {
  apply: orgProcedure(
    { allocation: ["apply"] },
    orgInput.extend({ receiptId: z.uuid(), invoiceId: z.uuid(), amount: positiveMoney }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const entryDate = businessDate(new Date(), await orgTimeZone(scope.orgId));

    const rows = await db.transaction(async (tx) => {
      const applied = await applyAllocations(tx, scope, {
        sourceDocumentId: input.receiptId,
        sourceState: "posted",
        targets: [{ documentId: input.invoiceId, amountPaise: input.amount }],
        entryDate,
      });

      for (const row of applied.rows) {
        await recordEntry(tx, scope, {
          kind: "post",
          document: {
            id: row.id,
            posting: {
              type: "allocation",
              direction: "advanceToInvoice",
              partyId: applied.partyId,
              amountPaise: row.amountPaise,
            },
          },
          entryDate,
          narration: "Apply receipt advance to invoice",
        });
      }

      return applied.rows;
    });

    audit({
      action: "allocation.apply",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: input.receiptId,
      meta: {
        allocationIds: rows.map((row) => row.id),
        invoiceId: input.invoiceId,
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
    const entryDate = businessDate(new Date(), await orgTimeZone(scope.orgId));

    const reversed = await db.transaction((tx) =>
      reverseAllocation(tx, scope, input.allocationId, entryDate, input.reason),
    );

    audit({
      action: "allocation.reverse",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: input.allocationId,
      meta: {
        reversalId: reversed.id,
        amount: formatDecimal(reversed.amountPaise),
        reason: input.reason,
      },
    });

    return reversed;
  }),
};
