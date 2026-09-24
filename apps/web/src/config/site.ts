/* The site's identity and its public surface, in one place. `sitemap.xml`,
   `robots.txt`, the SEO head and the `X-Robots-Tag` middleware all read
   `PUBLIC_ROUTES`, so publishing a page is one edit here.

   No environment access: `scripts/generate-og.ts` imports this from a plain Bun
   process. The origin is supplied by whoever calls. */

export const siteConfig = {
  name: "Accly Books",
  description:
    "Accounting software for small and mid-sized Indian businesses — parties, items, GST invoices, receipts and a ledger derived from them.",
  /* The root route's <title>: what an unlisted or non-public route ships with,
     since every public page overrides it via `pageHead`. */
  fallbackTitle: "Accly Books — accounting software for Indian businesses",
} as const;

export const OG_IMAGE = { width: 1200, height: 630 } as const;

type PublicRoute = {
  path: string;
  title: string;
  description: string;
  ogImage: string;
};

export const PUBLIC_ROUTES: PublicRoute[] = [
  {
    path: "/",
    title: "Accly Books — the books your business actually runs on",
    description: siteConfig.description,
    ogImage: "/og/home.png",
  },
  {
    path: "/customers",
    title: "Parties",
    description:
      "One record for every customer, vendor and other counterparty, with its GSTIN, receipts and ledger, found by name or GSTIN.",
    ogImage: "/og/customers.png",
  },
  {
    path: "/billing",
    title: "Invoices, receipts and GST",
    description:
      "GST invoices at dated rates, drafts until posted, receipts against invoices or as advances, and open and overdue invoices on one list.",
    ogImage: "/og/billing.png",
  },
  {
    path: "/changelog",
    title: "Changelog",
    description: "What changed in Accly Books, dated, in the order it shipped.",
    ogImage: "/og/changelog.png",
  },
  {
    path: "/about",
    title: "About",
    description:
      "Why Accly Books exists: accounting software for small and mid-sized Indian businesses, built with one business before it is sold to the next.",
    ogImage: "/og/about.png",
  },
  {
    path: "/contact",
    title: "Contact",
    description: "Reach the Accly Books team on WhatsApp or by email.",
    ogImage: "/og/contact.png",
  },
  {
    path: "/privacy",
    title: "Privacy",
    description: "What Accly Books collects, what it does with it, and how to reach us about it.",
    ogImage: "/og/privacy.png",
  },
];
