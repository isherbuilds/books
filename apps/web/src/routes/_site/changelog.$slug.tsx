import { Link, createFileRoute, notFound } from "@tanstack/react-router";

import { PageHero } from "@/components/landing/page-hero";
import { CHANGELOG, formatDate } from "@/content/changelog";
import { changelogEntryHead } from "@/lib/seo";

export const Route = createFileRoute("/_site/changelog/$slug")({
  loader: async ({ params }) => {
    const { CHANGELOG } = await import("@/content/changelog");
    const entry = CHANGELOG.find((candidate) => candidate.slug === params.slug);

    if (!entry) throw notFound();

    // Components do not serialize; the page re-resolves the entry by slug.
    return { slug: entry.slug, title: entry.title, summary: entry.summary, date: entry.date };
  },
  head: ({ loaderData }) => (loaderData ? changelogEntryHead(loaderData) : {}),
  component: ChangelogEntryRoute,
});

function ChangelogEntryRoute() {
  const { slug } = Route.useLoaderData();
  const entry = CHANGELOG.find((candidate) => candidate.slug === slug);

  if (!entry) throw notFound();

  return (
    <>
      <PageHero kicker={`${formatDate(entry.date)} · Changelog`} title={entry.title}>
        {entry.summary}
      </PageHero>
      <div className="wrap flex flex-col gap-10">
        <div className="prose">
          <entry.Content />
        </div>
        <Link to="/changelog" className="text-sm font-medium hover:text-(--ink-muted)">
          ← All changes
        </Link>
      </div>
    </>
  );
}
