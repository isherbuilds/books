import { expect, test } from "bun:test";

import { linkRows } from "../../apps/web/src/lib/link-rows";

type Row = { name: string; code?: string };

const sharma: Row = { name: "Sharma Traders", code: "27AAAPS1234C1Z5" };

const asha: Row = { name: "Asha Sharma" };

const kapoor: Row = { name: "Kapoor Stores" };

const rows = [kapoor, asha, sharma];

const options = (query: string, overrides: Partial<Parameters<typeof linkRows<Row>>[0]> = {}) => ({
  items: rows,
  query,
  selected: null,
  selectedLabel: "",
  canCreate: true,
  getKey: (row: Row) => row.name,
  getLabel: (row: Row) => row.name,
  getCode: (row: Row) => row.code,
  ...overrides,
});

test("prefix matches lead, substring matches follow, and Create comes last", () => {
  expect(linkRows(options("sha"))).toEqual([sharma, asha, { __create: "sha" }]);
});

test("an existing name, a committed value, or no create grant offers no Create row", () => {
  expect(linkRows(options("kapoor stores"))).toEqual([kapoor]);
  expect(
    linkRows(options("Kapoor Stores", { selected: kapoor, selectedLabel: "Kapoor Stores" })),
  ).toEqual(rows);
  expect(linkRows(options("sha", { canCreate: false }))).toEqual([sharma, asha]);
});

test("at most eight matches show, with Create still last", () => {
  const many = Array.from({ length: 12 }, (_, index): Row => ({ name: `Shah ${index}` }));

  expect(linkRows(options("shah", { items: many }))).toEqual([
    ...many.slice(0, 8),
    { __create: "shah" },
  ]);
});

test("an untyped field lists its saved value first, even past the limit", () => {
  const many = Array.from({ length: 12 }, (_, index): Row => ({ name: `Shah ${index}` }));
  const saved = many[10]!;

  expect(
    linkRows(options("Shah 10", { items: many, selected: saved, selectedLabel: "Shah 10" })),
  ).toEqual([saved, ...many.slice(0, 7)]);
});
