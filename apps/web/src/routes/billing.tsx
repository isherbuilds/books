import { createFileRoute } from "@tanstack/react-router";

import { FeaturePage } from "@/components/landing/feature-page";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/billing")({
  head: () => pageHead({ path: "/billing" }),
  component: () => (
    <FeaturePage
      shot="billing"
      eyebrow="Invoices, receipts and GST"
      title="Know what you are owed"
      lead="GST invoices at the rate in force on the day, receipts that settle them, and every open invoice on one list."
      windowTitle="Invoices · Meridian Traders"
      captureAlt="The app's Invoices list: number, date, due date, party, reference, status and total for each invoice"
      crops={[
        {
          region: { x: 272, y: 120, w: 1144, h: 260 },
          claim: "Draft first. Post when it is right.",
          body: "An invoice stays a draft until you post it. Posting gives it the next number in its series and writes the ledger; after that it never changes, and a mistake is cancelled by a reversal.",
        },
        {
          shot: "invoiceRecord",
          region: { x: 900, y: 200, w: 540, h: 600 },
          claim: "The GST rate of the invoice date, not today's.",
          body: "An Item carries its HSN or SAC and a tax code, and rates are dated, so each line takes the rate in force on the invoice date. Place of supply splits it into CGST and SGST or IGST, and the lines decide whether the invoice is a Tax Invoice or a Bill of Supply.",
        },
        {
          region: { x: 640, y: 270, w: 776, h: 230 },
          claim: "Open and overdue, one filter away.",
          body: "Search by number, party or reference; filter by date, party, state or settlement. A receipt settles invoices when it is posted or is held as an advance and applied later, and an allocation is reversed, never edited.",
        },
      ]}
    />
  ),
});
