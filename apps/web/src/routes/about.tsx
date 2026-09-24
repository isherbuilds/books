import { Link, createFileRoute } from "@tanstack/react-router";

import { PROSE, PublicPage } from "@/components/landing/public-page";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/about")({
  head: () => pageHead({ path: "/about" }),
  component: () => (
    <PublicPage
      eyebrow="About"
      title="Built with one business before it is sold to the next."
      lead="Accly Books is accounting and billing software for small and mid-sized Indian businesses: the party, the item, the invoice, the receipt and the ledger, in one system."
    >
      <div className={PROSE}>
        <h2>How it started</h2>
        <p>
          Accly Books began in August 2026 alongside the founder's own businesses: three
          Organizations and the chartered accountant who keeps their books. Rather than replace
          their software all at once, we built the smallest thing that could hold a real month — one
          record per party, one immutable document, one ledger derived from both — and put it in
          front of the people who would use it.
        </p>
        <p>
          Everything since has shipped the same way — a vertical slice, run on real books,
          corrected, then kept. The <Link to="/changelog">changelog</Link> is that history.
        </p>

        <h2>What we believe</h2>
        <h3>One dataset per business, and nothing shared.</h3>
        <p>
          Every record carries exactly one organization, and every request proves membership before
          it reads or writes anything — including the audit log and uploaded files. There is no
          cross-tenant path to switch off, because there is no cross-tenant path.
        </p>
        <h3>Money is never overwritten.</h3>
        <p>
          A posted document never changes. A mistake is cancelled by a reversal, and money applied
          to an invoice is an allocation that is reversed, never edited. The ledger is a
          double-entry projection of those documents, so an accountant gets source records, not a
          summary they have to trust.
        </p>
        <h3>Only states someone can observe.</h3>
        <p>
          A document is a draft, posted or cancelled. Whether an invoice is paid comes from the
          receipts allocated to it, not from a flag someone sets, because a status nobody can verify
          is a status that is always wrong.
        </p>
        <h3>Nothing is claimed before it is held.</h3>
        <p>
          We do not generate IRNs on the e-invoicing portal yet, and the footer says so. Purchase
          bills, credit notes, inventory and bank reconciliation have no page here because they do
          not run yet. A module appears on this site the day a business can use it.
        </p>

        <h2>Where it is going</h2>
        <p>
          Parties, items, GST invoices and receipts with allocations are live, with journals,
          opening balances, period locks and a chart of accounts behind them, and roles for owner,
          accountant, CA and operator. Next is the pilot's own list: the CA's sign-off on tax
          classifications and printed fields, purchase bills and notes, and the month-end reports.
          After that, modules open only when a business with a named owner asks — inventory and bank
          reconciliation among them.
        </p>

        <h2>Who we are</h2>
        <p>
          A small team, not yet incorporated, building this alongside the business that runs it.
          When the company exists, its legal name, registration and registered office will appear
          here and in the footer, as the law requires. Until then, you can{" "}
          <Link to="/contact">reach us directly</Link>.
        </p>
      </div>
    </PublicPage>
  ),
});
