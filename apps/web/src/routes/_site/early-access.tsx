import { env } from "@accly/env/web";
import { createFileRoute } from "@tanstack/react-router";

import { PageHero } from "@/components/landing/page-hero";
import { sendOnWhatsApp } from "@/components/landing/send-on-whatsapp";
import { CONTACT_MAILTO, CONTACT_PHONE, WHATSAPP_URL } from "@/lib/contact";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/_site/early-access")({
  head: () => pageHead({ path: "/early-access" }),
  component: EarlyAccessPage,
});

const ROLES = ["The business owner", "The accountant", "A CA or accounting firm"];

const KEPT_IN = [
  "Tally",
  "Busy",
  "Zoho Books",
  "Vyapar or myBillBook",
  "Excel",
  "Paper registers",
  "Something else",
];

const TURNOVER = [
  "Under ₹50 lakh",
  "₹50 lakh – ₹5 crore",
  "₹5 crore – ₹50 crore",
  "Over ₹50 crore",
];

const WAY = "flex flex-col gap-0.5 border-t border-(--line) py-4 first:border-t-0 first:pt-0";

const WAY_VALUE =
  "text-[19px] font-medium tracking-[-0.01em] tabular-nums [overflow-wrap:anywhere]";

function EarlyAccessPage() {
  return (
    <>
      <PageHero kicker="Early access" title="Tell us about your books.">
        We’re opening Books to a small group of businesses first. Fill this in, then send the
        prepared message in WhatsApp so we can discuss a walkthrough.
      </PageHero>

      <section
        aria-label="Request form"
        className="wrap grid gap-[clamp(40px,6vw,80px)] min-[861px]:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
      >
        <div className="flex flex-col text-sm text-(--ink-muted)">
          <div className={WAY}>
            Call or WhatsApp
            <a href={WHATSAPP_URL} className={`${WAY_VALUE} text-(--ink)`}>
              {CONTACT_PHONE}
            </a>
          </div>
          <div className={WAY}>
            Email
            <a href={CONTACT_MAILTO} className={`${WAY_VALUE} text-(--ink)`}>
              {env.VITE_CONTACT_EMAIL}
            </a>
          </div>
          <div className={WAY}>
            What happens next
            <b className="text-[17px] leading-normal font-medium text-(--ink)">
              We’ll discuss your current books and whether the pilot fits. Do not send customer
              records in the first message.
            </b>
          </div>
        </div>

        <form
          onSubmit={(event) => sendOnWhatsApp(event, "I’d like early access to Edernal Books.")}
          className="grid gap-x-4 gap-y-4.5 min-[641px]:grid-cols-2"
        >
          <label className="field">
            Your name
            <input name="Name" autoComplete="name" required />
          </label>
          <label className="field">
            Business name
            <input name="Business" autoComplete="organization" required />
          </label>
          <label className="field">
            Mobile
            <span className="prefix">
              <span>+91</span>
              <input
                name="Mobile"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder="98765 43210"
                pattern="[0-9]{5} ?[0-9]{5}"
                title="A 10-digit mobile number, like 98765 43210"
                required
              />
            </span>
          </label>
          <label className="field">
            <span>
              Email <small>(optional)</small>
            </span>
            <input
              name="Email"
              type="email"
              autoComplete="email"
              placeholder="you@yourbusiness.in"
            />
          </label>
          <label className="field">
            City
            <input name="City" autoComplete="address-level2" placeholder="Jaipur" />
          </label>
          <label className="field">
            <span>
              GSTIN <small>(optional)</small>
            </span>
            <input
              name="GSTIN"
              maxLength={15}
              placeholder="08AABCS1234F1Z5"
              autoComplete="off"
              autoCapitalize="characters"
              pattern="[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][1-9A-Za-z][Zz][0-9A-Za-z]"
              title="15 characters, like 08AABCS1234F1Z5"
              className="uppercase placeholder:normal-case"
            />
          </label>
          <label className="field">
            You are
            <select name="Role">
              {ROLES.map((role) => (
                <option key={role}>{role}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Books kept in
            <select name="Books kept in">
              {KEPT_IN.map((place) => (
                <option key={place}>{place}</option>
              ))}
            </select>
          </label>
          <label className="field col-span-full">
            Yearly turnover
            <select name="Yearly turnover" defaultValue={TURNOVER[1]}>
              {TURNOVER.map((band) => (
                <option key={band}>{band}</option>
              ))}
            </select>
          </label>
          <label className="field col-span-full">
            <span>
              Anything we should know? <small>(optional)</small>
            </span>
            <textarea
              name="Notes"
              placeholder="For example: 2 branches, about 400 invoices a month, CA in Jodhpur."
            />
          </label>
          <div className="col-span-full flex flex-wrap items-center justify-between gap-6">
            <p className="text-sm text-(--ink-muted)">
              WhatsApp opens a draft. Press Send there to contact us.
            </p>
            <button type="submit" className="btn">
              Continue to WhatsApp
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
