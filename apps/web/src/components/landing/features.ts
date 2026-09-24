import { ContactRoundIcon, FileTextIcon } from "lucide-react";

import type { Region, ShotName } from "./product-window";

/* The shipped modules that have a page. One list feeds the header's Product
   panel, the landing index grid, the footer's Product column and each feature
   page's sibling row, so the marketing surface and the product's own sidebar
   never use two words for one thing.

   Only modules with a capture are listed. Others join when they have one. */
export const FEATURES: {
  shot: ShotName;
  to: "/customers" | "/billing";
  shelf: "Sales";
  label: string;
  blurb: string;
  icon: typeof FileTextIcon;
  /* What the landing card shows: a distinctive slice, not the whole screen. */
  thumbnail: Region;
}[] = [
  {
    shot: "customers",
    to: "/customers",
    shelf: "Sales",
    label: "Parties",
    blurb: "Every counterparty, with its GSTIN and ledger.",
    icon: ContactRoundIcon,
    thumbnail: { x: 275, y: 130, w: 760, h: 440 },
  },
  {
    shot: "billing",
    to: "/billing",
    shelf: "Sales",
    label: "Invoices & receipts",
    blurb: "GST invoices, receipts and advances.",
    icon: FileTextIcon,
    thumbnail: { x: 275, y: 64, w: 760, h: 440 },
  },
];
