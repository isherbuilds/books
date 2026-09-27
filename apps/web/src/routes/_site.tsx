import { Outlet, createFileRoute, notFound, redirect } from "@tanstack/react-router";

import marketingCss from "@/components/landing/marketing.css?url";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";

/* Every public page: the Edernal Books header, footer and palette. The
   stylesheet is a head link rather than a side-effect import so a hard load
   renders styled from the server's first byte. */
export const Route = createFileRoute("/_site")({
  beforeLoad: ({ location }) => {
    // Preview the selected launch copy locally until its promised features ship.
    if (import.meta.env.DEV) return;

    if (location.pathname === "/") throw redirect({ to: "/login" });

    throw notFound();
  },
  head: () => ({
    links: [
      { rel: "stylesheet", href: marketingCss },
      { rel: "icon", href: "/brand/edernal-books-icon.svg", type: "image/svg+xml" },
    ],
  }),
  component: SiteLayout,
});

function SiteLayout() {
  return (
    <div className="site min-h-svh overflow-x-clip">
      <SiteHeader />
      <main id="main" tabIndex={-1} className="outline-none">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
