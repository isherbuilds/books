import { Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";

/* The closing ask on every page but the homepage, which ends in its own
   call-back form. */
export function CtaBand() {
  return (
    <section className="wrap pt-[clamp(24px,4vw,48px)]">
      <div className="band reveal grid items-end gap-10 rounded-[20px] bg-(--band) p-[clamp(40px,6vw,72px)] text-(--band-ink) ring-1 ring-(--band-line) min-[761px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <h2 className="text-[clamp(32px,4.4vw,54px)] leading-[1.04] font-[580] tracking-[-0.04em]">
          Bring one month of your books. We’ll show you the rest.
        </h2>
        <div>
          <p className="text-[17px] leading-[1.6] text-(--band-muted)">
            A 30-minute call with your own data. We import a month from Tally or Excel and show you
            it balanced in Books.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-6">
            <Link to="/early-access" className="btn">
              Get early access <ArrowRightIcon />
            </Link>
            <Link to="/pricing" className="font-medium hover:text-(--band-muted)">
              See pricing
            </Link>
          </div>
        </div>
        <div aria-hidden className="dbl draw col-span-full text-(--band-ink)" />
      </div>
    </section>
  );
}
