/* The homepage FAQ. One list, two presentations: the page renders it as native
   <details>, `seo.ts` serializes it into the homepage's FAQPage JSON-LD, so a
   crawler reads the same answer a visitor does. Lives apart from the page
   because `seo.ts` runs in `head()` and must not import JSX.

   "[Bracketed]" runs are facts the owner still has to confirm; the page marks
   them. */
export const FAQS: { q: string; a: string }[] = [
  {
    q: "Is my data safe? Who can see it?",
    a: "Your books are stored in India on [hosting provider], backed up every day and encrypted. Only people you invite can see them, and you can remove anyone in one tap. Every change is logged with who made it.",
  },
  {
    q: "What if the internet goes down?",
    a: "Books works on mobile data as well as office Wi-Fi, so a phone hotspot keeps you billing. [Offline billing: confirm before launch.]",
  },
  {
    q: "My CA only uses Tally. Will they agree?",
    a: "Most CAs are glad to stop collecting backups. We’ll call your CA, set up their free login and show them the trial balance and exports they’re used to.",
  },
  {
    q: "My staff know Tally. How long will this take to learn?",
    a: "Billing staff usually bill on day one. Keyboard shortcuts work for accountants who like speed, and we train your team on a call, in Hindi or English.",
  },
  {
    q: "Can I go back to Tally?",
    a: "Yes. Keep Tally untouched while you try Books, and export your Books data to Excel at any time. If Books isn’t for you in the first 30 days, we refund you in full.",
  },
  {
    q: "Will the price go up?",
    a: "Early-access businesses keep their price for 2 years. After that, we tell you a month before any change.",
  },
];
