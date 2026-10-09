import { IMPORT_GRANT } from "@accly/auth/access";
import { db } from "@accly/db";
import { z } from "zod";

import { audit } from "@accly/db/audit";
import { validateImport } from "../core/import-plan";
import { createAccounts, createItems, createParties } from "../core/masters";
import { formatDecimal } from "../core/money";
import { postOpening } from "../core/opening-items";
import { businessDate } from "../lib/business-date";
import { badRequest } from "../lib/conflict";
import { importTemplate, readImportWorkbook } from "../lib/import-workbook";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { orgSettings } from "../lib/org-settings";

export const importRouter = {
  template: orgProcedure(IMPORT_GRANT, orgInput).handler(() => importTemplate()),

  check: orgProcedure(IMPORT_GRANT, orgInput.extend({ file: z.file() })).handler(
    async ({ context, input }) => {
      const { orgId } = context.scope;
      const read = await readImportWorkbook(input.file);

      const { errors, errorCount, summary } = await validateImport(
        db,
        orgId,
        await orgSettings(orgId),
        read,
      );

      return { errors, errorCount, summary };
    },
  ),

  // All or nothing: every write happens in one transaction after the same validation
  // `check` runs, and any error rolls the whole workbook back.
  commit: orgProcedure(IMPORT_GRANT, orgInput.extend({ file: z.file() })).handler(
    async ({ context, input }) => {
      const { scope } = context;
      const read = await readImportWorkbook(input.file);

      const { summary, posted } = await db.transaction(async (tx) => {
        // FOR UPDATE, as the Opening Balance post: one cutover at a time.
        const settings = await orgSettings(scope.orgId, tx, "update");

        const { errorCount, summary, plan } = await validateImport(tx, scope.orgId, settings, read);

        if (!plan)
          throw badRequest(
            "IMPORT_INVALID",
            `The workbook has ${errorCount} error${errorCount === 1 ? "" : "s"}; nothing was imported. Check it again to see them.`,
          );

        await createAccounts(tx, scope.orgId, plan.accounts);
        await createParties(tx, scope.orgId, plan.parties, false);
        await createItems(tx, scope.orgId, plan.items, businessDate(new Date(), settings.timeZone));

        const posted = plan.opening ? await postOpening(tx, scope, settings, plan.opening) : null;

        return { summary, posted };
      });

      audit({
        action: "import.commit",
        actorId: scope.userId,
        orgId: scope.orgId,
        target: posted ? `openingBalance:${posted.id}` : `organization:${scope.orgId}`,
        meta: {
          ...summary,
          debitPaise: formatDecimal(summary.debitPaise),
          creditPaise: formatDecimal(summary.creditPaise),
          receivablesPaise: formatDecimal(summary.receivablesPaise),
          payablesPaise: formatDecimal(summary.payablesPaise),
        },
      });

      return { summary };
    },
  ),
};
