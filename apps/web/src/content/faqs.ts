import type { ShotName } from "@/components/landing/product-window";

/* One list of answers, two presentations: `faq.tsx` renders them as native
   <details>, `seo.ts` serializes them into the homepage's FAQPage JSON-LD, so
   an answer can never read differently to a crawler than it reads on the page.
   Lives apart from the component because `seo.ts` runs in `head()` and must
   not import a module full of JSX.

   Every answer is checked against the code, and two of them say "no". An FAQ
   that only sells is not an FAQ — in this category the buyer is explicitly
   hunting for what you cannot do. */
export const FAQS: { q: string; a: string; features: ShotName[] }[] = [
  {
    q: "Can another business see our data?",
    a: "No. Every record carries exactly one organization, and every request proves your membership before it reads or writes anything, including the audit log and uploaded files. There is no shared-tenant path to switch off.",
    features: ["customers"],
  },
  {
    q: "How do staff get accounts?",
    a: "You create them. There is no public sign-up: an administrator creates each account and assigns one or more roles from owner, admin, reception, cashier and accountant. Nobody can register themselves into your books.",
    features: ["customers"],
  },
  {
    q: "Does it need the internet?",
    a: "It needs your server, not the public internet. Fonts, styles and scripts are served from the application itself, so an office LAN with no outbound connection renders the full interface.",
    features: ["billing"],
  },
  {
    q: "What does it cost?",
    a: "Pricing depends on your size and which modules you run, so there is no public price list. A walkthrough ends with a written quote; one afternoon of setup and the desk is on it the next day.",
    features: ["customers", "billing"],
  },
  {
    q: "Is it ready for GST?",
    a: "Invoices print your legal name, address and GSTIN, and there is a GST outward register report for any date range in Excel or PDF. It is a register your accountant works from, not a filing export. You or your CA still file the return.",
    features: ["billing"],
  },
  {
    q: "Do you support e-invoicing and the IRP?",
    a: "Not yet. IRN generation needs registration with an invoice registration portal and a completed sandbox process, and we will not claim it before we hold it. Invoices are already immutable once issued and every field is exportable, so the work is additive rather than a migration.",
    features: ["billing"],
  },
  {
    q: "What happens when we bill something wrong?",
    a: "It is corrected, never overwritten. An issued invoice is immutable; a refund or a credit note records the correction against it, so the trail shows what happened rather than only the final number.",
    features: ["billing"],
  },
  {
    q: "Can we get our data out?",
    a: "Yes. Every report exports to Excel or PDF over any date range, and invoices and receipts render as PDFs. Your records are yours.",
    features: ["customers", "billing"],
  },
];
