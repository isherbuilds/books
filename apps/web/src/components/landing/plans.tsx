import type { ReactNode } from "react";

/* Both plan sections show the same offer. Keep prices, limits and inclusion here. */
export const PLANS: {
  name: string;
  forWhom: string;
  price: string;
  perDay: string;
  badge?: string;
  features: readonly ReactNode[];
  homeCta: string;
}[] = [
  {
    name: "Starter",
    forWhom: "A shop or service business with one billing desk.",
    price: "₹4,999",
    perDay: "About ₹14 a day",
    features: [
      "1 GSTIN, 2 users",
      "GST invoices, payments, WhatsApp reminders",
      "Ledgers and GST reports",
      "Free CA login",
      "Tally switch done with you",
    ],
    homeCta: "Start with Starter",
  },
  {
    name: "Business",
    badge: "Most businesses",
    forWhom: "Traders and distributors with an accountant and a busy bank account.",
    price: "₹9,999",
    perDay: "About ₹27 a day",
    features: [
      "Everything in Starter, 5 users",
      "Bank matching",
      "GSTR-2B check, e-invoice, e-way bill",
      "MSME 45-day alerts",
    ],
    homeCta: "Get Business",
  },
  {
    name: "Growth",
    forWhom: "Branches, several GSTINs, or a hospital on Edernal Care.",
    price: "₹19,999",
    perDay: "About ₹55 a day",
    features: [
      "Everything in Business, 15 users",
      <span key="gstins">
        Up to <span className="fill">[5]</span> GSTINs and branches
      </span>,
      "Approvals before posting",
      "Edernal Care billing flows in",
    ],
    homeCta: "Talk to us",
  },
];
