import { expect, test } from "bun:test";

import {
  rankCommands,
  type PaletteGroup,
  type PaletteItem,
  type PaletteSection,
} from "../../apps/web/src/lib/palette";

function command(id: string, label: string, group: PaletteGroup, keywords?: string[]): PaletteItem {
  return { id, label, group, keywords, run: () => {} };
}

const ids = (sections: PaletteSection[]) =>
  sections.flatMap(({ items }) => items.map(({ id }) => id));

test("empty query orders groups while preserving order within each group", () => {
  const items = [
    command("party-1", "First party", "party"),
    command("action-1", "First action", "action"),
    command("go-1", "First destination", "go"),
    command("action-2", "Second action", "action"),
    command("party-2", "Second party", "party"),
  ];

  expect(ids(rankCommands(items, "   "))).toEqual([
    "action-1",
    "action-2",
    "go-1",
    "party-1",
    "party-2",
  ]);
});

test("label matches rank by prefix, word prefix, then substring", () => {
  const items = [
    command("substring", "Unrecorded", "action"),
    command("none", "Parties", "go"),
    command("word-prefix", "New receipt", "party"),
    command("label-prefix", "Receipts", "document"),
  ];

  expect(ids(rankCommands(items, "rec"))).toEqual(["label-prefix", "word-prefix", "substring"]);
});

test("keyword-only matches rank below label matches", () => {
  const items = [
    command("keyword", "Settle", "action", ["payments"]),
    command("label", "Open payments", "document"),
  ];

  expect(ids(rankCommands(items, "pay"))).toEqual(["label", "keyword"]);
});

test("a group stays together and ranks by its best match", () => {
  const items = [
    command("party-weak", "Unrecorded", "party"),
    command("go", "Go to receipts", "go"),
    command("party-strong", "Recon Traders", "party"),
    command("action", "Record", "action"),
  ];

  const sections = rankCommands(items, "rec");

  expect(ids(sections)).toEqual(["action", "party-strong", "party-weak", "go"]);
  expect(sections.map(({ group }) => group)).toEqual(["action", "party", "go"]);
});

test("score ties fall back to group order", () => {
  const items = [
    command("document", "Find rec", "document"),
    command("party", "Find rec", "party"),
    command("organization", "Find rec", "organization"),
    command("go", "Find rec", "go"),
    command("action", "Find rec", "action"),
  ];

  expect(ids(rankCommands(items, "rec"))).toEqual([
    "action",
    "go",
    "organization",
    "party",
    "document",
  ]);
});

test("record groups are capped at eight rows in input order", () => {
  const parties = Array.from({ length: 10 }, (_, index) =>
    command(`acme-${index + 1}`, `Acme ${index + 1}`, "party"),
  );

  const sections = rankCommands([...parties, command("action", "Invite Acme", "action")], "acme");

  expect(sections.find(({ group }) => group === "party")?.items.map(({ id }) => id)).toEqual(
    parties.slice(0, 8).map(({ id }) => id),
  );
});
