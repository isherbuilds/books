import { Link } from "@tanstack/react-router";
import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { WHATSAPP_URL } from "@/lib/contact";

import { NAV } from "./site-header";
import { WaIcon } from "./wa-icon";
import { Wordmark } from "./wordmark";

const LINK = "hover:text-(--ink)";

const PAGES = [
  { label: "Early access", to: "/early-access" },
  { label: "Invoices and GST", to: "/billing" },
  { label: "Parties", to: "/customers" },
] as const;

const COMPANY = [
  { label: "About", to: "/about" },
  { label: "Contact", to: "/contact" },
  { label: "Changelog", to: "/changelog" },
  { label: "Privacy", to: "/privacy" },
] as const;

const SUITE = [
  { label: "edernal.com", href: "https://edernal.com" },
  { label: "Edernal Care", href: "https://care.edernal.com" },
  { label: "Security", href: "https://edernal.com/security.html" },
  { label: "Terms", href: "https://edernal.com/terms.html" },
] as const;

/* The markup never depends on the resolved theme (undefined during SSR); the
   `dark` class on <html> picks the icon, and the click reads the theme after
   mount. */
function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="-m-2 p-2 hover:text-(--ink)"
    >
      <SunIcon className="hidden size-4 dark:block" />
      <MoonIcon className="size-4 dark:hidden" />
    </button>
  );
}

export function SiteFooter() {
  return (
    <>
      <footer className="mt-[clamp(72px,9vw,120px)] border-t border-(--line) pt-9 pb-9 max-[760px]:pb-[calc(96px+env(safe-area-inset-bottom))]">
        <div className="wrap">
          <div className="flex flex-wrap justify-between gap-5 text-sm text-(--ink-muted)">
            <nav aria-label="Footer" className="flex flex-wrap gap-x-5.5 gap-y-2">
              {[...NAV, ...PAGES].map(({ label, ...link }) => (
                <Link key={label} {...link} className={LINK}>
                  {label}
                </Link>
              ))}
            </nav>
            <nav aria-label="Company" className="flex flex-wrap gap-x-5.5 gap-y-2">
              {COMPANY.map(({ label, to }) => (
                <Link key={label} to={to} className={LINK}>
                  {label}
                </Link>
              ))}
              {SUITE.map(({ label, href }) => (
                <a key={label} href={href} className={LINK}>
                  {label}
                </a>
              ))}
            </nav>
          </div>
          <Link to="/" aria-label="Edernal Books home" className="mt-[clamp(48px,7vw,96px)] block">
            <Wordmark className="w-full" />
          </Link>
          <div className="mt-4.5 flex flex-wrap items-center justify-between gap-4 text-[13px] text-(--ink-muted)">
            <span>
              © 2026 <span className="fill">[Legal entity name]</span> · Made in India · Every rupee
              in the right ledger.
            </span>
            <span className="flex items-center gap-4">
              books.edernal.com · an Edernal suite
              <ThemeSwitch />
            </span>
          </div>
        </div>
      </footer>

      {/* Phones keep both ways to reach us under the thumb. */}
      <div className="fixed inset-x-0 bottom-0 z-50 hidden gap-2 border-t border-(--line) bg-(--paper) px-3 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom))] max-[760px]:flex">
        <a
          className="btn line h-[46px] flex-1 text-[15px]"
          href={WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          <WaIcon />
          WhatsApp
        </a>
        <Link to="/" hash="callback" className="btn h-[46px] flex-1 text-[15px]">
          Call me back
        </Link>
      </div>
    </>
  );
}
