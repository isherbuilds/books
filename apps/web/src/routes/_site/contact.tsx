import { env } from "@accly/env/web";
import { createFileRoute } from "@tanstack/react-router";
import { MailIcon } from "lucide-react";

import { PageHero } from "@/components/landing/page-hero";
import { WaIcon } from "@/components/landing/wa-icon";
import { CONTACT_MAILTO, WHATSAPP_URL } from "@/lib/contact";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/_site/contact")({
  head: () => pageHead({ path: "/contact" }),
  component: () => (
    <>
      <PageHero
        kicker="Contact"
        title="Talk to the people who built it."
        actions={
          <>
            <a className="btn" href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
              <WaIcon />
              WhatsApp us
            </a>
            <a className="btn line" href={CONTACT_MAILTO}>
              <MailIcon />
              {env.VITE_CONTACT_EMAIL}
            </a>
          </>
        }
      >
        No sales team, no form that goes nowhere. WhatsApp reaches us fastest; email works too.
      </PageHero>
      <div className="wrap">
        <div className="prose">
          <h2>What to send</h2>
          <p>
            Your business's name and city, roughly how many invoices a month, and what you run the
            desk on today. That is enough for us to show you the right screens.
          </p>
          <h2>What not to send</h2>
          <p>
            <strong>Do not send customer information</strong> — no names, customer codes, reports or
            prescriptions — over WhatsApp or email. Neither channel is where customer data belongs,
            and we will not use it if it arrives.
          </p>
          <h2>Existing customers</h2>
          <p>
            Staff accounts are created by your business's administrator, not by us. For access
            problems, ask them first; for anything about the software itself, the same channels
            above reach the people who wrote it.
          </p>
        </div>
      </div>
    </>
  ),
});
