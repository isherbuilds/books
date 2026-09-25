import type { LucideIcon } from "lucide-react";

export type PaletteGroup = "action" | "go" | "organization" | "party" | "document";

export type PaletteItem = {
  id: string;
  label: string;
  group: PaletteGroup;
  keywords?: string[];
  /** Muted text after the label: a Party's GSTIN, a document's Party. */
  detail?: string;
  /** Right-aligned meta: an amount or a state. */
  hint?: string;
  /** Overrides the group icon; navigation rows use their sidebar icon. */
  icon?: LucideIcon;
  run: () => void;
};

export type PaletteSection = { group: PaletteGroup; items: PaletteItem[] };

const GROUP_RANK: Record<PaletteGroup, number> = {
  action: 0,
  go: 1,
  organization: 2,
  party: 3,
  document: 4,
};

// Midday caps results per type (apps/api/src/schemas/search.ts). Parties arrive whole
// and documents arrive from several registers, so both groups take the cap here.
const RECORD_LIMIT = 8;

function matchScore(item: PaletteItem, query: string): number {
  const label = item.label.toLowerCase();

  if (label.startsWith(query)) return 4;

  if (label.split(/\s+/).some((word) => word.startsWith(query))) return 3;

  if (label.includes(query)) return 2;

  if (item.keywords?.some((keyword) => keyword.toLowerCase().includes(query))) return 1;

  return 0;
}

type RankedSection = {
  best: number;
  rows: { item: PaletteItem; index: number; score: number }[];
};

export function rankCommands(items: PaletteItem[], query: string): PaletteSection[] {
  const normalizedQuery = query.trim().toLowerCase();
  const sections = new Map<PaletteGroup, RankedSection>();

  items.forEach((item, index) => {
    // An empty query scores every item alike, so groups fall back to their rank.
    const score = normalizedQuery ? matchScore(item, normalizedQuery) : 1;

    if (score === 0) return;

    const section = sections.get(item.group) ?? { best: 0, rows: [] };
    section.best = Math.max(section.best, score);
    section.rows.push({ item, index, score });
    sections.set(item.group, section);
  });

  // One heading per group: a group ranks by its best match, so an exact Party still
  // leads a weak action match; ties keep the group order.
  return [...sections]
    .sort(
      ([leftGroup, left], [rightGroup, right]) =>
        right.best - left.best || GROUP_RANK[leftGroup] - GROUP_RANK[rightGroup],
    )
    .map(([group, { rows }]) => ({
      group,
      items: rows
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, group === "party" || group === "document" ? RECORD_LIMIT : rows.length)
        .map(({ item }) => item),
    }));
}
