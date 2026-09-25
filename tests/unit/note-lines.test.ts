import { expect, test } from "bun:test";

import { computeNoteLines } from "@accly/api/core/note-lines";

test("full credit takes exact remaining tax while partial lines round together", () => {
  expect(
    computeNoteLines({
      intraState: true,
      lines: [
        {
          source: {
            taxablePaise: 10_000n,
            cgstPaise: 900n,
            sgstPaise: 900n,
            igstPaise: 0n,
            rateBasisPoints: 1_800,
          },
          prior: { taxablePaise: 9_999n, cgstPaise: 899n, sgstPaise: 899n, igstPaise: 0n },
          amountPaise: 1n,
        },
        ...[0, 1].map(() => ({
          source: {
            taxablePaise: 10n,
            cgstPaise: 1n,
            sgstPaise: 1n,
            igstPaise: 0n,
            rateBasisPoints: 500,
          },
          prior: { taxablePaise: 0n, cgstPaise: 0n, sgstPaise: 0n, igstPaise: 0n },
          amountPaise: 5n,
        })),
      ],
    }),
  ).toEqual({
    ok: true,
    lines: [
      { taxablePaise: 1n, cgstPaise: 1n, sgstPaise: 1n, igstPaise: 0n },
      { taxablePaise: 5n, cgstPaise: 0n, sgstPaise: 0n, igstPaise: 0n },
      { taxablePaise: 5n, cgstPaise: 0n, sgstPaise: 0n, igstPaise: 0n },
    ],
  });
});

test("taxable and component over-credits return the offending index", () => {
  const source = {
    taxablePaise: 100n,
    cgstPaise: 1n,
    sgstPaise: 1n,
    igstPaise: 0n,
    rateBasisPoints: 1_800,
  };

  const prior = { taxablePaise: 0n, cgstPaise: 1n, sgstPaise: 1n, igstPaise: 0n };
  const valid = { source, prior, amountPaise: 0n };
  expect(
    computeNoteLines({ intraState: true, lines: [valid, { source, prior, amountPaise: 101n }] }),
  ).toEqual({ ok: false, index: 1 });
  expect(
    computeNoteLines({ intraState: true, lines: [valid, { source, prior, amountPaise: 50n }] }),
  ).toEqual({ ok: false, index: 1 });
});
