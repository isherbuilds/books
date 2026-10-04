import { expect, test } from "bun:test";

import { linkRows } from "../../apps/web/src/lib/link-rows";

type Row = { name: string; code?: string };

const sharma: Row = { name: "Sharma Traders", code: "27AAAPS1234C1Z7" };

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

test("opening lists six choices, and one character can find a name or start Create", () => {
  const many = Array.from({ length: 12 }, (_, index): Row => ({ name: `Party ${index}` }));

  expect(linkRows(options("", { items: many }))).toEqual(many.slice(0, 6));
  expect(linkRows(options(" s "))).toEqual([sharma, kapoor, asha, { __create: "s" }]);
});

test("an existing name, a committed value, or no create grant offers no Create row", () => {
  expect(linkRows(options("kapoor stores"))).toEqual([kapoor]);
  expect(
    linkRows(options("Kapoor Stores", { selected: kapoor, selectedLabel: "Kapoor Stores" })),
  ).toEqual(rows);
  expect(linkRows(options("sha", { canCreate: false }))).toEqual([sharma, asha]);
});

test("at most six matches show, with Create still last", () => {
  const many = Array.from({ length: 12 }, (_, index): Row => ({ name: `Shah ${index}` }));

  expect(linkRows(options("shah", { items: many }))).toEqual([
    ...many.slice(0, 6),
    { __create: "shah" },
  ]);
});

test("an untyped field lists its saved value first, even past the limit", () => {
  const many = Array.from({ length: 12 }, (_, index): Row => ({ name: `Shah ${index}` }));
  const saved = many[10]!;

  let keyReads = 0;

  const getKey = (row: Row) => {
    keyReads++;

    return row.name;
  };

  expect(
    linkRows(
      options("Shah 10", { items: many, selected: saved, selectedLabel: "Shah 10", getKey }),
    ),
  ).toEqual([saved, ...many.slice(0, 5)]);
  expect(keyReads).toBeLessThanOrEqual(8);
  expect(
    linkRows(options("Shah 1", { items: many, selected: many[1]!, selectedLabel: "Shah 1" })),
  ).toEqual([many[1]!, many[0]!, ...many.slice(2, 6)]);
});
