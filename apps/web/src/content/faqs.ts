import type { ShotName } from "@/components/landing/product-window";

/* One list of answers, two presentations: `faq.tsx` renders them as native
   <details>, `seo.ts` serializes them into the homepage's FAQPage JSON-LD, so
   an answer can never read differently to a crawler than it reads on the page.
   Lives apart from the component because `seo.ts` runs in `head()` and must
   not import a module full of JSX.

   Every answer is checked against the code, and several of them say "not yet". An FAQ
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
    a: "By invitation. There is no public sign-up: an owner invites each person with one or more roles from owner, accountant, CA and operator, and an account can be created only from that invitation. Nobody can register themselves into your books.",
    features: ["customers"],
  },
  {
    q: "Does it need the internet?",
    a: "Yes. Accly Books is online software, and offline entry is not built. Fonts, styles and scripts are served by the application itself, so it depends on no other site.",
    features: ["billing"],
  },
  {
    q: "What does it cost?",
    a: "One price per owner covers every organization that owner runs. There is no public price list while the pilot runs; accounts are by invitation.",
    features: ["customers", "billing"],
  },
  {
    q: "Is it ready for GST?",
    a: "Invoices take the GST rate in force on the invoice date, split it into CGST and SGST or IGST by place of supply, and are a Tax Invoice or a Bill of Supply by their lines. GST registers and return exports are not built yet; you or your CA file the return.",
    features: ["billing"],
  },
  {
    q: "Do you support e-invoicing and the IRP?",
    a: "Not yet. IRN generation needs registration with an invoice registration portal and a completed sandbox process, and we will not claim it before we hold it. A posted invoice is already immutable, so the work is additive rather than a migration.",
    features: ["billing"],
  },
  {
    q: "What happens when we bill something wrong?",
    a: "It is corrected, never overwritten. A posted invoice is immutable: cancelling it posts a reversing entry, and you issue a new one, so the trail shows what happened rather than only the final number. Credit notes are not built yet.",
    features: ["billing"],
  },
  {
    q: "Can we get our data out?",
    a: "Partly, today. Receipts print as PDFs. The day book and TDS register Excel exports exist but have no screen yet; accounting reports with exports are the next slice. Your records are yours.",
    features: ["customers", "billing"],
  },
];
