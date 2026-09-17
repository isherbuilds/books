import { expect, test } from "bun:test";

import { computeTax, roundOff } from "@accly/api/core/tax";

test("tax splits intra-state GST and keeps inter-state GST whole", () => {
  const lines = [{ taxablePaise: 10_000n, rateBasisPoints: 1_800 }];

  expect(computeTax({ intraState: true, lines })).toEqual({
    lines: [{ cgstPaise: 900n, sgstPaise: 900n, igstPaise: 0n }],
    cgstPaise: 900n,
    sgstPaise: 900n,
    igstPaise: 0n,
  });
  expect(computeTax({ intraState: false, lines })).toEqual({
    lines: [{ cgstPaise: 0n, sgstPaise: 0n, igstPaise: 1_800n }],
    cgstPaise: 0n,
    sgstPaise: 0n,
    igstPaise: 1_800n,
  });
  // 0.25% halves to 12.5 paise per component, which rounds half-up.
  expect(
    computeTax({ intraState: true, lines: [{ taxablePaise: 10_000n, rateBasisPoints: 25 }] }),
  ).toMatchObject({ cgstPaise: 13n, sgstPaise: 13n });
});

test("tax rounds the running total so lines sum to the document total", () => {
  const lines = Array.from({ length: 3 }, () => ({
    taxablePaise: 3_333n,
    rateBasisPoints: 500,
  }));

  const tax = computeTax({ intraState: true, lines });

  expect(tax.lines).toEqual([
    { cgstPaise: 83n, sgstPaise: 83n, igstPaise: 0n },
    { cgstPaise: 84n, sgstPaise: 84n, igstPaise: 0n },
    { cgstPaise: 83n, sgstPaise: 83n, igstPaise: 0n },
  ]);
  expect(tax).toMatchObject({ cgstPaise: 250n, sgstPaise: 250n, igstPaise: 0n });
});

test("a line without a rate carries no tax and round-off is a signed adjustment", () => {
  expect(
    computeTax({
      intraState: false,
      lines: [
        { taxablePaise: 10_000n, rateBasisPoints: 1_800 },
        { taxablePaise: 5_000n, rateBasisPoints: null },
      ],
    }).lines,
  ).toEqual([
    { cgstPaise: 0n, sgstPaise: 0n, igstPaise: 1_800n },
    { cgstPaise: 0n, sgstPaise: 0n, igstPaise: 0n },
  ]);
  expect(roundOff(12_349n)).toBe(-49n);
  expect(roundOff(12_350n)).toBe(50n);
  expect(roundOff(12_351n)).toBe(49n);
});
