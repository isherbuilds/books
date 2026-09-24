import { createFileRoute } from "@tanstack/react-router";

import { FeaturePage } from "@/components/landing/feature-page";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/customers")({
  head: () => pageHead({ path: "/customers" }),
  component: () => (
    <FeaturePage
      shot="customers"
      eyebrow="Parties"
      title="Every party, one keystroke away"
      lead="Customers, vendors, tenants, donors, employees and government, in one list. Each Party carries its GSTIN, its receipts and its ledger."
      windowTitle="Parties · Meridian Traders"
      captureAlt="The app's Parties list: name, GSTIN and amount received for each party"
      crops={[
        {
          region: { x: 272, y: 60, w: 720, h: 260 },
          claim: "One search box. Name or GSTIN.",
          body: "Filter by status, role or GST registration without leaving the list. One GSTIN belongs to one Party, so the same number always finds the same record.",
        },
        {
          region: { x: 272, y: 160, w: 1144, h: 520 },
          claim: "Every counterparty, as a list you can read.",
          body: "Name, GSTIN and what each has paid you, in name order or sorted by what was received.",
        },
        {
          shot: "partyRecord",
          region: { x: 900, y: 0, w: 540, h: 620 },
          claim: "Open one without losing your place.",
          body: "A quick look opens over the list. The full record has its receipts and a ledger read from posted entries, so the balance is never typed in.",
        },
      ]}
    />
  ),
});
