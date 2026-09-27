import { Link } from "@tanstack/react-router";

import { WHATSAPP_URL } from "@/lib/contact";

import { WaIcon } from "./wa-icon";
import { Wordmark } from "./wordmark";

/* The main navigation, shared with the footer. */
export const NAV = [
  { label: "Product", to: "/", hash: "outcomes" },
  { label: "Switch from Tally", to: "/tally" },
  { label: "For CAs", to: "/cas" },
  { label: "Pricing", to: "/pricing" },
] as const;

const NAV_LINK =
  "text-(--ink-muted) hover:text-(--ink) aria-[current=page]:text-(--ink) aria-[current=page]:font-medium";

function NavLinks() {
  return NAV.map(({ label, ...link }) => (
    <Link key={label} {...link} activeOptions={{ includeHash: true }} className={NAV_LINK}>
      {label}
    </Link>
  ));
}

export function SiteHeader() {
  return (
    <>
      <p className="bg-(--band) px-4 py-2.5 text-center text-sm text-(--band-ink)">
        Early access: <b className="font-semibold text-(--band-stamp)">the first 50 businesses</b>{" "}
        get their Tally switch done free and keep their price for 2 years.{" "}
        <Link to="/early-access" className="underline underline-offset-3">
          Claim a place
        </Link>
      </p>
      <header className="site-top sticky top-0 z-40 bg-(--paper)">
        <div className="wrap flex h-16 items-center justify-between gap-9">
          <Link to="/" aria-label="Edernal Books home" className="shrink-0">
            <Wordmark className="w-[166px]" />
          </Link>
          <nav aria-label="Main" className="hidden flex-1 gap-6.5 text-[14.5px] min-[901px]:flex">
            <NavLinks />
          </nav>
          <div className="flex items-center gap-2.5">
            <a
              className="btn sm line max-[900px]:hidden"
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <WaIcon />
              WhatsApp us
            </a>
            <Link to="/early-access" className="btn sm max-[380px]:hidden">
              Get early access
            </Link>
          </div>
        </div>
        <nav
          aria-label="Main, small screens"
          className="wrap flex gap-5 overflow-x-auto pb-3 text-sm whitespace-nowrap [scrollbar-width:none] min-[901px]:hidden"
        >
          <NavLinks />
        </nav>
      </header>
    </>
  );
}
