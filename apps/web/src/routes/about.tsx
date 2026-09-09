import { Link, createFileRoute } from "@tanstack/react-router";

import { PROSE, PublicPage } from "@/components/landing/public-page";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/about")({
  head: () => pageHead({ path: "/about" }),
  component: () => (
    <PublicPage
      eyebrow="About"
      title="Built with one business before it is sold to the next."
      lead="Accly Books is desk software for small and mid-sized Indian businesses: the customer, the item, the invoice and the ledger, in one system."
    >
      <div className={PROSE}>
        <h2>How it started</h2>
        <p>
          Accly Books began in August 2026 alongside one business's front desk, which was running on
          an older billing system it had outgrown. Rather than replace it all at once, we built the
          smallest thing that could stand in for a working day — one list of what is owed, one
          record per customer, one immutable invoice — and put it in front of the people who would
          use it.
        </p>
        <p>
          Everything since has shipped the same way — a vertical slice, run at a real desk,
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
          An issued invoice is immutable. Discounts after issue are credit notes; money returned is
          a refund; every payment produces its own receipt. The ledger is a double-entry projection
          of those documents, so an accountant gets source records, not a summary they have to
          trust.
        </p>
        <h3>Only states someone can observe.</h3>
        <p>
          A document is drafted, issued, paid or corrected. We removed the states nobody at the desk
          can actually see, because a status nobody can verify is a status that is always wrong.
        </p>
        <h3>Nothing is claimed before it is held.</h3>
        <p>
          We do not generate IRNs on the e-invoicing portal yet, and the footer says so. Purchases,
          inventory and bank reconciliation have no page here because they do not run yet. A module
          appears on this site the day a business can use it.
        </p>

        <h2>Where it is going</h2>
        <p>
          The customer, item, invoice and payment path is live, with a double-entry ledger and GST
          register behind it. Next is the pilot's own list: printer validation, the day-close
          runbook and role splits for reception, cashier and accountant. After that, modules open in
          the order businesses actually need them and only when one has a named owner asking —
          purchases and vendor bills, then inventory, then bank reconciliation.
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
