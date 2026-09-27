import { Link, createFileRoute } from "@tanstack/react-router";

import { PageHero } from "@/components/landing/page-hero";
import { CHANGELOG, formatDate } from "@/content/changelog";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/_site/changelog/")({
  head: () => pageHead({ path: "/changelog" }),
  component: () => (
    <>
      <PageHero kicker="Changelog" title="What changed, dated, in the order it shipped." />
      <ol className="wrap flex flex-col">
        {CHANGELOG.map((entry) => (
          <li key={entry.slug} className="reveal border-t border-(--line) py-7">
            <Link
              to="/changelog/$slug"
              params={{ slug: entry.slug }}
              className="group grid gap-2 min-[861px]:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] min-[861px]:gap-6"
            >
              <time dateTime={entry.date} className="pt-1 text-sm text-(--ink-muted) tabular-nums">
                {formatDate(entry.date)}
              </time>
              <span className="flex flex-col gap-2">
                <h2 className="text-2xl font-semibold tracking-[-0.02em] underline-offset-4 group-hover:underline">
                  {entry.title}
                </h2>
                <p className="max-w-[40em] text-(--ink-muted) text-pretty">{entry.summary}</p>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </>
  ),
});
