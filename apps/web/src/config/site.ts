/* The site's identity and its public surface, in one place. `sitemap.xml`,
   `robots.txt`, the SEO head and the `X-Robots-Tag` middleware all read
   `PUBLIC_ROUTES`, so publishing a page is one edit here.

   No environment access: `scripts/generate-og.ts` imports this from a plain Bun
   process. The origin is supplied by whoever calls. */

export const siteConfig = {
  name: "Accly Books",
  description:
    "Accounting software for small and mid-sized Indian businesses — customers, items, GST invoices, payments and a ledger that ties out.",
  /* The root route's <title>: what an unlisted or non-public route ships with,
     since every public page overrides it via `pageHead`. */
  fallbackTitle: "Accly Books — accounting software for Indian businesses",
} as const;

export const OG_IMAGE = { width: 1200, height: 630 } as const;

export type PublicRoute = {
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
    title: "Customers and contacts",
    description:
      "One customer record with its code, contact details and every document raised against it, found by name, code or phone.",
    ogImage: "/og/customers.png",
  },
  {
    path: "/billing",
    title: "Invoicing, payments and GST",
    description:
      "Invoices, credit notes, refunds, cash and bank receipts, and a GST outward register your accountant can work from.",
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
