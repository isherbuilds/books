import { db } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { documentLines } from "@accly/db/schema/document-lines";
import { documents } from "@accly/db/schema/documents";
import { taxRates } from "@accly/db/schema/tax-rates";
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { RegisterLine } from "../core/gst-register";
import { postedNumber } from "../core/documents";
import { impossible } from "./conflict";

const againstDocument = alias(documents, "against_document");

// One joined read of posted document lines, with the source document for note references.
export async function gstRegisterRows(
  orgId: string,
  from: string,
  to: string,
  side: "outward" | "inward",
): Promise<RegisterLine[]> {
  const rows = await db
    .select({
      documentId: documents.id,
      type: documents.type,
      number: documents.number,
      documentDate: documents.documentDate,
      partyName: sql<string | null>`${documents.printSnapshot}->'party'->>'name'`,
      partyGstin: sql<string | null>`${documents.printSnapshot}->'party'->>'gstin'`,
      placeOfSupplyStateCode: documents.placeOfSupplyStateCode,
      intraState: documents.intraState,
      documentTotalPaise: documents.totalPaise,
      againstId: againstDocument.id,
      againstNumber: againstDocument.number,
      againstDate: againstDocument.documentDate,
      supplyClass: accounts.supplyClass,
      rateBasisPoints: taxRates.rateBasisPoints,
      hsnSac: documentLines.hsnSac,
      taxablePaise: documentLines.amountPaise,
      cgstPaise: documentLines.cgstPaise,
      sgstPaise: documentLines.sgstPaise,
      igstPaise: documentLines.igstPaise,
      itcEligible: documentLines.itcEligible,
    })
    .from(documents)
    .innerJoin(
      documentLines,
      and(eq(documentLines.orgId, orgId), eq(documentLines.documentId, documents.id)),
    )
    .innerJoin(accounts, and(eq(accounts.orgId, orgId), eq(accounts.id, documentLines.accountId)))
    .leftJoin(taxRates, and(eq(taxRates.orgId, orgId), eq(taxRates.id, documentLines.taxRateId)))
    .leftJoin(
      againstDocument,
      and(eq(againstDocument.orgId, orgId), eq(againstDocument.id, documents.againstDocumentId)),
    )
    .where(
      and(
        eq(documents.orgId, orgId),
        eq(documents.state, "posted"),
        eq(documents.affectsTax, true),
        gte(documents.documentDate, from),
        lte(documents.documentDate, to),
        isNull(documentLines.adjustmentKind),
        side === "outward"
          ? or(
              inArray(documents.type, ["invoice", "creditNote"]),
              and(eq(documents.type, "receipt"), eq(documents.settlementKind, "direct")),
            )
          : inArray(documents.type, ["bill", "debitNote"]),
      ),
    )
    .orderBy(asc(documents.documentDate), asc(documents.id), asc(documentLines.position));

  return rows.map((row) => {
    // A direct Receipt records its place of supply at post, like any claim.
    if (row.intraState === null) {
      throw impossible(`document ${row.documentId} has no supply type`);
    }

    if (
      row.type !== "invoice" &&
      row.type !== "creditNote" &&
      row.type !== "receipt" &&
      row.type !== "bill" &&
      row.type !== "debitNote"
    ) {
      throw impossible(`document ${row.documentId} has an unsupported GST register type`);
    }

    return {
      documentId: row.documentId,
      type: row.type,
      number: postedNumber(row.number, row.documentId),
      documentDate: row.documentDate,
      partyName: row.partyName,
      partyGstin: row.partyGstin,
      placeOfSupplyStateCode: row.placeOfSupplyStateCode,
      intraState: row.intraState,
      documentTotalPaise: row.documentTotalPaise,
      against: row.againstId
        ? {
            number: postedNumber(row.againstNumber, row.againstId),
            documentDate: row.againstDate!,
          }
        : null,
      supplyClass: row.supplyClass,
      rateBasisPoints: row.rateBasisPoints,
      hsnSac: row.hsnSac,
      taxablePaise: row.taxablePaise,
      cgstPaise: row.cgstPaise,
      sgstPaise: row.sgstPaise,
      igstPaise: row.igstPaise,
      itcEligible: row.itcEligible,
    };
  });
}
